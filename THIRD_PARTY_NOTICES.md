# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below, distributed under its own
license.

## ha-sinapsi-alfa (alexdelprete/ha-sinapsi-alfa)

<https://github.com/alexdelprete/ha-sinapsi-alfa>, by Alessandro Del Prete,
the Home Assistant custom integration for the Sinapsi Alfa. Version 1.13.11,
`main` at commit 5d88f99 (2026-10-02).

Ported to JavaScript in `src/alfa/model.js`, `src/constants.js` and
`src/alfa/client.js`: the register map of the Alfa (`const.py`
`SENSOR_ENTITIES` and `REGISTER_BATCHES`, `docs/sunspec-maps/Alfa Modbus
Register Map.xlsx`): holding registers, unit id 1, port 502, 16-bit powers
in W, 32-bit totals in Wh high word first, the tariff band at 203, the
cut-off warning at 780-782 and its "none" values (0xFFFFFFFF, 65535), the
production at 921-925; the batches read one after the other on one
connection, opened and closed around each read; the warm-up rule (a read
whose import total or band is 0 is rejected); the check that the production
total is not below the energy fed (`_calculate_derived_values`); the home
power as drawn + produced - fed. Changed here: the client is our own (no
ModbusLink), the daily band registers (30-65) are not read, the energies
derived from production are not computed, every lifetime total passes a
guard held until the user accepts it (src/guard.js) instead of keeping the
previous value silently, and "not available" values are never published.

Its license, reproduced as it appears in the repository:

```
MIT License

Copyright (c) 2024 Alessandro Del Prete

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
