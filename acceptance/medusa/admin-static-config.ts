// UI image build only: this wrapper is never copied into the API image.
// The official --admin-only command builds even with backend Admin disabled.
const backend = require('./medusa-backend-config')
module.exports = {
 ...backend,
 admin: { ...backend.admin, disable: true, path: '/dashboard', backendUrl: '' },
}
