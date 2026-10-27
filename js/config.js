/**
 * 站点内置配置（部署时填写，留空表示由用户在设置里自行填写）
 *
 * 说明：
 * - supabaseUrl / supabaseAnonKey 是 Supabase 项目的 Project URL 与 anon public key。
 *   这两项本就以公开形式下发到浏览器，写入前端不会被视作泄露；
 *   数据安全由数据库的行级安全策略（RLS）保证，而非密钥保密。
 * - 填写后，访问者无需任何配置即可使用云同步（仍须有身份，见 README「四、多设备同步」）。
 * - aiKey 不建议写死：一旦提交到仓库，任何人都可据此消耗你的额度；
 *   如需内置，请在部署平台使用环境变量并自行生成页面，或保持留空。
 */
export const SITE = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
