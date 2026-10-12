import { WorkspaceClient } from './shared/client';
import { fileJournal } from './shared/journal';
// Host/account setup supplies the reviewed HTTPS ingress and login broker.
// No model key, Connector credential or enterprise membership is in this app.
const client = new WorkspaceClient(wx, { baseUrl: '', journal: fileJournal(wx) });
App({ globalData: { client }, onHide() { /* Page lifecycle stops polling only. */ } });
