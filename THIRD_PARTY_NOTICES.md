# Third-party notices

React 18.3.1 and React DOM 18.3.1 are MIT licensed. Their notices are retained in
[React-LICENSE](licenses/React-LICENSE) and [React-DOM-LICENSE](licenses/React-DOM-LICENSE).
They are root development dependencies for optional Client tests; the native
plugin UI uses React supplied by the DeepSeek Harness host.

jsdom and its transitive development dependencies retain their notices in the
installed packages. No installed dependency bundle is committed here.

DeepSeek Harness is an external execution host. Its runtime and the previously
vendored SDK are not shipped by this source tree. Native plugin manifests refer
to the host's own services and packages; references are not copies of that code.
