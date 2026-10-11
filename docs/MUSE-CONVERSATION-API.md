# Original Muse conversation API

The entry is the reviewed original native conversation. Its Host uses the existing WorkerDesk order/approval/dispatch and original Muse custom Connector. No alternate model or executor is selected when Muse is requested. Ordinary application POST messages with provider:muse return 409 MW_NATIVE_CONVERSATION_REQUIRED until an original Host conversation binding exists; zero model Runs are created.

## Native Host endpoints

All routes require the original configured owner, original nativeAgentId, enterprise session/CSRF and original Host actor/epoch. Existing single Worker/mount policy is retained.

- GET /api/conversations/:nativeAgentId/muse-delegations returns {delegations:[...]}; GET with /:orderId returns {delegation}.
- POST /api/conversations/:nativeAgentId/messages with provider:muse, or POST /api/conversations/:nativeAgentId/muse-delegations, prepares a reviewed draft only. Response is {delegation,duplicate}, status201. It does not dispatch or wake Muse.
- POST /api/conversations/:nativeAgentId/muse-delegations/:orderId/approve and /dispatch both require {confirmed:true,expectedReviewHash}. Dispatch can only use the original exact approved order. No new request ID on retry.
- POST the same original order's /refresh with {} reads/reconciles the original task/job identity. It never replaces an uncertain job or restarts it.
- POST /cancel requires {confirmed:true,expectedReviewHash}. cancel_requested remains visible until the original Worker confirms stop.
- POST /accept requires {confirmed:true,expectedReviewHash,receiptHash}; the exact original Session must already have durably returned that receipt.
- GET /api/muse-worker-files/:id?version=1&sha256=:sha downloads only the original owner's exact result reference. The bound service also exposes download(orderId,{artifactId,version,sha256}) pinned to that delegation.

Prepare body:

```json
{"provider":"muse","conversationId":"original-native-session","requestId":"stable-original-id","content":"Explicit public research request","order":{"serviceId":"channel-validation","product":"Approved public facts","market":"US","objective":"Exact public scope, no external contact or publication","budgetCredits":5,"deadlineAt":"explicit-future-ISO-time","publicDataConfirmed":true}}
```

content maximum4000, product240, market100, objective2500. requestId preserves the original WorkerDesk bounded ID grammar (128 characters). Worker choice comes from the original server binding, never the body. Private RFQ/profile/file content, external write/contact, credentials or unrecognized fields do not become public execution authorization. The request/order review hash pins original conversation, message hash, service, public scope, budget and deadline.

## Persistent mapping and displayed facts

The original order gains museConversation; existing conversation/messages record the original request once. Original Muse Session receipt/outbox and artifacts remain authoritative. Equal original subject/requestId/scope returns one original order, even after restart or its deadline. Changed scope with the same ID conflicts. One unfinished original delegation per binding includes returned results awaiting acceptance. Login/reconnect is read/reconciliation only.

delegation includes provider, conversationId, orderId, requestId, reviewHash, review, orderStatus, approvalRequired, phase, taskRef, executionStatus, attemptId, fence, leaseUntil, deadlineAt, receipt, receiptHash, returnedHash, acceptedAt and blockerCode. Source timestamps are timestamps, not progress percentages.

| phase | Established fact |
| --- | --- |
| review_required | Draft awaits exact authorization |
| approved | Exact scope approved, not dispatched |
| dispatching | Original dispatch reserved, durable result pending |
| reconciliation_required | Unknown original dispatch outcome, reconcile same ID |
| queued | Original pending task before deadline |
| deadline_expired | Original pending task overdue, no automatic restart |
| claimed | Original attempt/fence claimed with valid lease, no proven model start |
| lease_expired | Original claim lease overdue, no replacement attempt |
| cancel_requested | Cancellation awaits original stop confirmation |
| result_ready | Result/file bytes recorded, not yet original Session return |
| result_returned | Original Session flush and business receipt durable |
| enterprise_accepted | Human accepted exact returned receipt |

wake remains {supported:false,observed:false,reason:"original_muse_wakeup_not_verified"}; executionStartedAt:null and independentlyVerified:false. No wake/model-start state is invented. Result relay agent.send(...,'next-step',false) inserts a receipt without triggering a turn. See MUSE-CONNECTOR-WAKE-EVIDENCE.md for official contracts and actual account evidence boundaries.

## Connector remains unchanged

/api/muse-worker/v1 retains the existing eleven operations and unchanged workspace-api.py Secure Vault/authd client. Approved pending work is pulled from the original inbox. Exact requestId, attemptId/fence, server lease, cancellation and artifact ID/version/SHA checks apply. This conversation API is a business mapping over those existing records, not another execution channel.

Current tests verify actual Windows disk/HTTP/artifact behavior; original Muse execution, native Session sender and registry module admission are explicitly fixtures where the original Host is unavailable. Full Host boot, actual existing account execution and browser acceptance remain unverified. No credentials, account authorization, Connector registration, schedule or production operation was performed.
