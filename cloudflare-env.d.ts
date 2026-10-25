declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    /** coach 端点可选服务凭据：配置后 /api/coach 要求 x-coach-token 匹配 */
    COACH_TOKEN?: string;
  }
}
