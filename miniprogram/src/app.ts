import { WorkspaceClient } from './shared/client';
import { fileJournal } from './shared/journal';
import { createWechatLoginBroker } from './shared/login-broker';
// Host/account setup supplies the reviewed HTTPS ingress and login broker.
// No model key, Connector credential or enterprise membership is in this app.
const baseUrl = ''; // Set only to the deployment's reviewed HTTPS native ingress.
const client = new WorkspaceClient(wx, { baseUrl, goalMode: 'muse', journal: fileJournal(wx), loginBroker: baseUrl ? createWechatLoginBroker(wx, baseUrl) : undefined });
App({ globalData: { client }, onHide() { /* Page lifecycle stops polling only. */ } });
