/* 点对点直传：WebRTC DataChannel + 配对串
 *
 * 不使用任何服务器：两台设备各自生成一段「配对串」（压缩后的
 * SDP 文本），通过微信 / QQ / 隔空投送等任意方式互换，
 * 之后数据就在两台设备之间直接传输（DTLS 加密，不经过第三方）。
 *
 * 用法（发送方）：
 *   const t = new Transfer();
 *   const code = await t.createOffer();      // 把 code 发给对方
 *   await t.applyAnswer(answerCode);         // 对方回传的应答串
 *   await t.send(exportJSON());
 *
 * 用法（接收方）：
 *   const t = new Transfer();
 *   const answer = await t.acceptOffer(offerCode);  // 回传给发送方
 *   t.onData = (text) => importJSON(text, 'merge');
 */

const STUN = [
  'stun:stun.l.google.com:19302',
  'stun:stun.miwifi.com:3478',
];

const CODE_PREFIX = 'pw1.';
const CHUNK = 48 * 1024;
const ICE_WAIT = 3000;
const OPEN_TIMEOUT = 30000;

/* ---------- 编码工具 ---------- */

function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function deflate(text) {
  if (typeof CompressionStream !== 'function') return null;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes) {
  if (typeof DecompressionStream !== 'function') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function packSignal(obj) {
  const text = JSON.stringify(obj);
  const zipped = await deflate(text);
  return CODE_PREFIX + bytesToB64url(zipped || new TextEncoder().encode(text));
}

export async function unpackSignal(code) {
  const raw = String(code || '').trim().replace(/\s+/g, '');
  if (!raw.startsWith(CODE_PREFIX)) throw new Error('配对串格式不对，请整段复制');
  const bytes = b64urlToBytes(raw.slice(CODE_PREFIX.length));
  let text = null;
  try {
    text = await inflate(bytes);
  } catch (e) {
    text = null;
  }
  if (!text) text = new TextDecoder().decode(bytes);
  let obj = null;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error('配对串内容损坏，请重新复制');
  }
  if (!obj || !obj.sdp || !obj.t) throw new Error('配对串无效');
  return obj;
}

function randomToken() {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- 传输 ---------- */

export class Transfer {
  constructor() {
    this.pc = null;
    this.dc = null;
    this.buf = null;
    this.off = 0;
    this.token = null;
    /** 收到完整数据时回调，参数是文本 */
    this.onData = null;
    /** 发送/接收进度，0~1 */
    this.onProgress = null;
    /** 连接建立 */
    this.onOpen = null;
    this.onError = null;
    this._closed = false;
  }

  _fail(message) {
    if (this._closed) return;
    if (this.onError) this.onError(message);
  }

  _newPeer() {
    const pc = new RTCPeerConnection({
      iceServers: STUN.map((urls) => ({ urls })),
    });
    pc.addEventListener('connectionstatechange', () => {
      const s = pc.connectionState;
      if (s === 'failed') this._fail('连接失败：两台设备可能不在同一个网络，请连同一个 WiFi 后重试');
      if (s === 'disconnected') this._fail('连接中断，请重新配对');
    });
    return pc;
  }

  _bindChannel() {
    const dc = this.dc;
    dc.binaryType = 'arraybuffer';
    dc.addEventListener('open', () => { if (this.onOpen) this.onOpen(); });
    dc.addEventListener('close', () => { this._closed = true; });
    dc.addEventListener('message', (e) => {
      if (typeof e.data === 'string') {
        let msg = null;
        try {
          msg = JSON.parse(e.data);
        } catch (err) {
          return;
        }
        if (msg.total != null) {
          this.buf = new Uint8Array(msg.total);
          this.off = 0;
          if (this.onProgress) this.onProgress(0);
        } else if (msg.done) {
          this._finish();
        }
        return;
      }
      if (!this.buf) return;
      const chunk = new Uint8Array(e.data);
      this.buf.set(chunk, this.off);
      this.off += chunk.length;
      if (this.onProgress) this.onProgress(Math.min(1, this.off / this.buf.length));
      if (this.off >= this.buf.length) this._finish();
    });
  }

  async _finish() {
    if (this._closed) return;
    this._closed = true;
    const bytes = this.buf ? this.buf.slice(0, this.off) : new Uint8Array(0);
    let text = null;
    try {
      text = await inflate(bytes);
    } catch (e) {
      text = null;
    }
    if (!text) text = new TextDecoder().decode(bytes);
    if (this.onData) this.onData(text);
  }

  _waitIce() {
    const pc = this.pc;
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      let settled = false;
      let count = 0;
      let quiet = null;
      let hardTimer = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        clearTimeout(quiet);
        pc.removeEventListener('icegatheringstatechange', check);
        pc.removeEventListener('icecandidate', onCandidate);
        resolve();
      };
      hardTimer = setTimeout(finish, ICE_WAIT);
      // 拿到候选后只要安静 450ms 就认为收集完成，省掉整段等待
      const onCandidate = (e) => {
        if (!e.candidate) { finish(); return; }
        count += 1;
        clearTimeout(quiet);
        quiet = setTimeout(() => { if (count > 0) finish(); }, 450);
      };
      const check = () => { if (pc.iceGatheringState === 'complete') finish(); };
      pc.addEventListener('icecandidate', onCandidate);
      pc.addEventListener('icegatheringstatechange', check);
    });
  }

  /** 发送方第一步：生成配对串 */
  async createOffer() {
    if (typeof RTCPeerConnection !== 'function') throw new Error('当前浏览器不支持点对点传输，请改用导出/导入');
    this.pc = this._newPeer();
    this.dc = this.pc.createDataChannel('pickword', { ordered: true });
    this._bindChannel();
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this._waitIce();
    this.token = randomToken();
    return packSignal({ t: 'offer', tok: this.token, sdp: this.pc.localDescription.sdp });
  }

  /** 接收方第一步：粘贴配对串，生成应答串 */
  async acceptOffer(code) {
    if (typeof RTCPeerConnection !== 'function') throw new Error('当前浏览器不支持点对点传输，请改用导出/导入');
    const sig = await unpackSignal(code);
    if (sig.t !== 'offer') throw new Error('这是应答串，应该贴到「发送方」那一侧');
    this.token = sig.tok || null;
    this.pc = this._newPeer();
    this.pc.addEventListener('datachannel', (e) => {
      this.dc = e.channel;
      this._bindChannel();
    });
    await this.pc.setRemoteDescription({ type: 'offer', sdp: sig.sdp });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this._waitIce();
    return packSignal({ t: 'answer', tok: this.token || '', sdp: this.pc.localDescription.sdp });
  }

  /** 发送方第二步：粘贴应答串，等待连接建立 */
  async applyAnswer(code) {
    const sig = await unpackSignal(code);
    if (sig.t !== 'answer') throw new Error('这是配对串，不是对方的应答串');
    if (!this.pc) throw new Error('请先点「生成配对串」');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp });
    await this.waitOpen();
  }

  waitOpen() {
    if (this.dc && this.dc.readyState === 'open') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('等待连接超时：请确认两台设备在同一网络，且对方的应答串是最新生成的'));
      }, OPEN_TIMEOUT);
      const onOpen = () => { cleanup(); resolve(); };
      const onFail = (msg) => { cleanup(); reject(new Error(msg)); };
      const cleanup = () => {
        clearTimeout(timer);
        this.onOpen = prevOpen;
        this.onError = prevError;
      };
      const prevOpen = this.onOpen;
      const prevError = this.onError;
      this.onOpen = () => { if (prevOpen) prevOpen(); onOpen(); };
      this.onError = (msg) => { if (prevError) prevError(msg); onFail(msg); };
    });
  }

  /** 发送整段文本（自动压缩、分片） */
  async send(text) {
    if (!this.dc || this.dc.readyState !== 'open') throw new Error('连接还没建立');
    const raw = new TextEncoder().encode(text);
    this.dc.send(JSON.stringify({ total: raw.length }));
    for (let i = 0; i < raw.length; i += CHUNK) {
      const slice = raw.slice(i, Math.min(i + CHUNK, raw.length));
      this.dc.send(slice);
      if (this.onProgress) this.onProgress(Math.min(1, (i + slice.length) / raw.length));
      // 给渲染与缓冲留出时间，避免一次性塞爆 data channel
      await new Promise((r) => setTimeout(r, 0));
    }
    this.dc.send(JSON.stringify({ done: true }));
  }

  close() {
    this._closed = true;
    try {
      if (this.dc) this.dc.close();
    } catch (e) { /* 忽略 */ }
    try {
      if (this.pc) this.pc.close();
    } catch (e) { /* 忽略 */ }
    this.pc = null;
    this.dc = null;
  }
}
