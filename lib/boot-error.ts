/* rv-14（G6，03 §6.1 ⑧③纯代码组织）：启动错误文案纯函数，自 app/workbench.tsx 抽出。
   三分支文案逐字保留：D1_ERROR / 401|登录 / 其余（含空串回退）。 */
export const friendlyError = (m: string) => m.includes('D1_ERROR') ? '本地数据库连接失败，请重启开发服务后重试' : m.includes('401') || m.includes('登录') ? '请登录后继续' : m ? '加载失败：' + m : '加载失败，请重试';
