# PR99 follow-up: separate proxy from database and inspect live ingress

While preparing the fix on 6f41b0ce45334d2bba17ca0ef25ef0e928907541, branch head advanced to 6789079fe8578b205f2cbad10d21cf0f1d18d33b. The lease prevented overwriting it. This follow-up reuses that implementation, including its nginx path/method rules, packing fix and migration preparation, rather than adding another proxy.

Medusa UI previously shared private with PostgreSQL/Redis. UI now joins only frontend (internal) and ingress; API joins frontend plus private; DB/Redis remain private with no published ports. Existing finite Docker fixture and Compose assertions are adapted to frontend. Added standalone Python live inspection and explicit process-restart checks; see acceptance/ingress/README.md.

Actual local results: 4 Python/PyYAML contract tests passed; Python source compiled. No Docker executable is installed; the live preflight failed with FileNotFoundError (retained as failure in docs/validation/pr99-ingress-20261017/live-preflight.json). Browser inventory had only about:blank, no authenticated Tencent terminal. No server operation occurred. Existing full Compose/nginx Docker tests could not be rerun here; prior commit's reported tests are prior evidence, not this run's results.

Pending live checks: fixed complete image build, loopback reachability/authentication, process restart and container recreation recovery, original Host approved parse and no-consent/revoked/source-change rejection. Proxy egress exists and is not an ACL; corresponding network authorization remains necessary. No public/firewall/host-unit change, real file transfer, model call, PR94 catalog write smoke, main change or merge.
