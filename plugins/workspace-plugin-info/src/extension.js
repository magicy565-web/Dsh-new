export default function extension(pi) {
  pi.registerTool({ name: 'workspace_plugin_info', label: 'Plugin loading probe',
    description: 'Return static plugin identity; no files, network, credentials or writes.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() { return { content: [{ type: 'text', text: 'workspace-plugin-info: loaded; side effects: none' }] }; } });
}
