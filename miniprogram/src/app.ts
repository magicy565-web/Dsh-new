import { WorkspaceClient } from './shared/client';
// Host/account setup supplies the reviewed HTTPS ingress and login broker.
// No model key, Connector credential or enterprise membership is in this app.
const client = new WorkspaceClient(wx, { baseUrl: '' });
App({ globalData: { client }, onHide() { /* Page lifecycle stops polling only. */ } });
