# Road Truck Functionality

Road trucks connect the landside gatehouse with the yard.

## Truck Types

There are two current truck visit types:

- Export delivery trucks bring export containers into the terminal.
- Import pickup trucks arrive empty, collect import containers, and leave with them.

Each truck carries at most one container.

## Export Delivery Flow

An export delivery truck:

- Queues outside the in-gate.
- Enters when the export lane is open.
- Waits through gate processing.
- Drives to the export yard truck stand.
- Waits for the reach stacker to remove its container.
- Returns to the out-gate.
- Departs the terminal.

## Import Pickup Flow

An import pickup truck:

- Queues outside the in-gate.
- Enters when the import lane is open.
- Waits through gate processing.
- Drives to the import yard truck stand.
- Waits for the reach stacker to load its assigned import container.
- Returns to the out-gate.
- Waits through out-gate processing.
- Departs the terminal with the container.

## Queuing

Trucks keep stable queue positions so they do not jump around while waiting.

Only one truck is processed at each gate position at a time.

## Yard Waiting

Trucks wait at yard stands until the required reach stacker job is completed.

The sim prevents trucks from crowding the same yard stand area.

## Revenue Event

An import pickup truck earns $100 when it completes out-gate processing with its container.

