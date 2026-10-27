# gladys-sinapsi-alfa

Unofficial [Gladys Assistant](https://gladysassistant.com) integration for the
**Sinapsi Alfa**, the device that reads the Italian 2G electricity meters
(and the production meter) over Chain 2, read through its **local Modbus TCP
server**, no cloud, no key. Not affiliated with Sinapsi.

**Never tested with a real device**: built from the Home Assistant integration
[ha-sinapsi-alfa](https://github.com/alexdelprete/ha-sinapsi-alfa) (MIT) and
its register map, ported to JavaScript with our own small Modbus TCP client.

- One device (the Alfa gives no serial over Modbus: one Alfa per integration).
- Every 30 seconds: powers drawn, fed, produced and used at home, the
  quarter-hour averages, the tariff band (F1 to F6), the cut-off warning.
- Once a minute: the energy drawn (the Gladys consumption index), fed (a grid
  output index, never billed) and produced (the production index), each
  checked by a guard: never 0, a drop or a jump held until the user accepts it
  in two clicks.
- The Alfa starting (registers at 0), "not available" values, production data
  missing and frozen registers: nothing sent, the status says why.
- Read-only: the only Modbus function sent is "read holding registers"; one
  connection per read, closed right after it (the Alfa serves one client).

Documentation: [English](docs/en.md), [français](docs/fr.md).

## Development

```bash
npm install
npm test
npm run lint
npm run format:check
```

License: Apache-2.0 (see `LICENSE` and `THIRD_PARTY_NOTICES.md`).
