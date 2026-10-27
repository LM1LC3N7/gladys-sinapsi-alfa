# Sinapsi Alfa

Unofficial integration, not affiliated with Sinapsi. It reads the **Sinapsi
Alfa**, the device that reads the Italian 2G electricity meters (and, when
present, the production meter) over "Chain 2", through its **local Modbus
TCP server**: no cloud, no account, no key. **Read-only**: the only request
ever sent is "read holding registers" (Modbus function 3), one read every 30
seconds at most.

**Never tested with a real device**: it was built from the Home Assistant
integration ha-sinapsi-alfa (Alessandro Del Prete, MIT) and its register map.
The Sinapsi documentation of the registers for the current firmware could not
be found: the addresses are the ones of that integration, the same in another
independent project. Feedback welcome.

## What you get

One device, **Sinapsi Alfa**. Its features appear as the Alfa shows them
(no production features without production data, no export features before
the first kWh fed to the grid):

| Feature                               | Kind                      |
| ------------------------------------- | ------------------------- |
| Home power                            | energy sensor, W          |
| Power drawn                           | grid, power drawn, W      |
| Power fed                             | grid, power fed, W        |
| Power produced                        | production, W             |
| Energy drawn (index)                  | energy index, kWh         |
| Energy fed (index)                    | grid, energy fed, kWh     |
| Energy produced (index)               | production index, kWh     |
| Power drawn, quarter-hour average (W) | plain sensor              |
| Power fed, quarter-hour average (W)   | plain sensor              |
| Tariff band (1 = F1 ... 6 = F6)       | plain sensor              |
| Cut-off warning                       | plain sensor, 1 = warning |
| Cut-off in (s)                        | plain sensor, seconds     |

- **Home power** = power drawn + power produced - power fed. Without
  production data (see below), it is sent only for a home that never fed the
  grid (then it is the power drawn).
- **Energy drawn** feeds the Gladys energy monitoring (consumption and cost);
  **energy produced** feeds the production. **Energy fed** is never counted as
  consumption nor production.
- The **three indexes** are lifetime totals. They are published once a minute
  at most and checked first, each by its own guard: a value of 0 is never
  sent; any drop, even of 1 Wh, or a jump larger than what could have flowed
  (the "highest plausible power" of the configuration, 100 kW by default,
  over the time since the last value) is **held back** (the last accepted
  value is sent again) and shown in the integration status. If it is right
  (a new meter, a reset, another Alfa), click **Accept the held index** twice
  (see Buttons). Saving the configuration never accepts it. A held index stays
  held after a restart.
- The **tariff band** is a number from 1 to 6 (F1 to F6); another value is
  not sent.
- The **cut-off warning** is 1 while the meter announces a supply cut (too
  much power drawn), 0 otherwise; **Cut-off in** gives the seconds left when
  the meter gives them (it is not updated once the warning ends). The status
  also shows the time of the cut, in UTC.
- The daily totals of each band (registers 30 to 65) are not read.

## Values that are not sent

- **The Alfa is starting**: after a restart, its registers read 0 for a few
  minutes. A read whose energy drawn or tariff band is 0 sends nothing at all
  (the status says the Alfa is starting).
- **Not available**: a power of 65535 W, a total of 4294967295 Wh.
- **Production data**: valid only when the production total is above 0 and
  not below the energy fed (one never feeds more than one produces). Otherwise
  production and home power are not sent and the status says so.
- **Frozen values**: when no register of the Alfa has changed for 30 minutes,
  nothing is sent until one moves (the status says so). This age is kept in
  `/data` across restarts.

## One Alfa per integration

The Alfa gives no serial number over Modbus: the integration reads one Alfa,
and its device is that one whatever the address. If you put another Alfa
behind the address, its totals do not follow the old ones: the guards hold
them back until you accept them.

## One Modbus client at a time

The Alfa serves **a single Modbus TCP client**. The integration opens the
connection for each read (four requests, one after the other, never two at
once) and closes it right after, so it holds the Alfa for a fraction of a
second every 30 seconds. Another Modbus client connected all the time (a Home
Assistant Modbus configuration, for example) may prevent the reads: the
status then says the connection could not be made.

## Setup

1. Find the IP address of the Alfa in your router, and preferably give it a
   fixed address there.
2. In Gladys, open the integration, enter this address (with a port only if
   it is not 502) and save.
3. In the **Discover** tab, create the device.

## Buttons

- **Test the connection**: reads the Alfa once when a read is due (never more
  than one every 30 seconds), otherwise tells the last read: the powers, the
  band and the three indexes (a held index is said so).
- **Accept the held index**, in two clicks. The first click lists the indexes
  held back and takes nothing. The second click, a few seconds to 5 minutes
  later, takes what the first listed, for each index whose held value has not
  changed since (beyond what may have flowed meanwhile). A jump is counted at
  once; a drop counts nothing.

## When something goes wrong

- **Unreachable, no answer, wrong answer**: new try after 30 seconds, then
  doubled up to 10 minutes. A request without an answer within 5 seconds
  closes the connection (a late answer is never taken for another one).
- **The Alfa refuses some registers** (a Modbus exception on the band, the
  cut-off warning or the production): those values are not read, the others
  go on, and the status says which. A refusal of the grid registers (2 to 19)
  fails the read.
- **The configuration cannot be read from Gladys** at a (re)connection: new
  try after 5 seconds, doubled up to 5 minutes, the status says so; meanwhile
  the reads go on with the last configuration received, if any.
- **The state file in `/data` cannot be read**: it is left as it is (never
  written over) and the status says so; a held index may then be forgotten.

## Privacy

Everything stays on your network. The integration only connects to the
address you entered, on the Modbus TCP port.
