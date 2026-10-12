import type { Session } from './client';

/** Reviewed HTTPS native ingress only. wx.login supplies a fresh code; server
 * mapping, signing key and original Session issuance never enter this client. */
export function createWechatLoginBroker(platform: Pick<typeof wx, 'request'>, origin: string) {
  return (code: string): Promise<{ token: string; session: Session }> => new Promise((resolve, reject) => {
    if (!/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/i.test(origin)) { reject(new Error('微信登录服务尚未绑定审核过的 HTTPS 地址。')); return; }
    platform.request<{ token: string; session: Session; error?: { code?: string; message?: string } }>({
      url: origin + '/api/session/wechat', method: 'POST', data: { code }, header: { 'Content-Type': 'application/json' }, timeout: 10000, redirect: 'manual',
      success: result => {
        if (result.statusCode !== 200 || !result.data?.token || result.data.session?.authenticated !== true) { reject(new Error(result.data?.error?.message || '微信登录未完成，请重新获取登录码。')); return; }
        resolve({ token: result.data.token, session: result.data.session });
      },
      fail: () => reject(new Error('微信登录回执尚未确认，请重新获取登录码。')),
    });
  });
}
