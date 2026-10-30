// An example plugin with one of each extension point. Copy it into the plugins folder (see the README) and restart.
// The tracker address and the metrics numbers are placeholders: replace them with your own.

export default {
  name: 'service-list',

  // Reads a text file of "a -> b" lines, starting with "# services".
  importers: [
    {
      id: 'services',
      name: 'service list',
      matches: (text) => text.startsWith('# services'),
      read(text) {
        const pairs = text
          .split('\n')
          .map((line) => line.split('->').map((s) => s.trim()))
          .filter((pair) => pair.length === 2 && pair[0] && pair[1]);
        const names = [...new Set(pairs.flat())];
        return { nodes: names.map((key) => ({ key })), edges: pairs.map(([from, to]) => ({ from, to })) };
      },
    },
  ],

  // Writes every part as a CSV row.
  exporters: [
    {
      id: 'csv',
      name: 'Parts as CSV',
      extension: 'csv',
      render: (design) => ['id,type,label', ...design.components.map((c) => [c.id, c.type, JSON.stringify(c.label)].join(','))].join('\n') + '\n',
    },
  ],

  // Samples per pair of services: requests per second, failed per second, round-trip seconds, as from Prometheus.
  metrics: [
    {
      name: 'Fixed sample',
      read: () => ({ qps: [{ client: 'web', server: 'api', value: 12 }], failed: [], latency: [{ client: 'web', server: 'api', value: 0.05 }] }),
    },
  ],

  // Turns a ticket ref such as OPS-12 into its address.
  links: [{ kind: 'ticket', url: (value) => (/^[A-Z]+-\d+$/.test(value) ? `https://tickets.example.com/browse/${value}` : undefined) }],
};
