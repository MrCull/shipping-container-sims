# Monetary System Functionality

Money represents the terminal's current operating balance.

## Revenue

The current tutorial has two revenue events:

- Import gate-out revenue: $100 per import container that leaves through the out-gate.
- Export vessel-load revenue: $150 per export container loaded onto the vessel.

Revenue is added immediately when the paying event completes.

## Costs

The current tutorial has two operating costs:

- Reach stacker move cost: $10 per completed non-revenue reach stacker move.
- Quay crane import unload cost: $20 per completed import discharge from vessel to quay.

Costs are deducted when the move completes.

## Tutorial Total

The tutorial includes 5 import gate-outs and 5 export vessel loads.

Gross revenue from these paying events is:

- 5 import gate-outs at $100 each = $500
- 5 export vessel loads at $150 each = $750
- Gross total = $1,250

Operating costs reduce the visible money balance unless god mode is active.

## Money Feedback

Money changes are shown through:

- The money display
- Event feed messages
- Floating money indicators in the 3D scene
- Sound effects

## God Mode

When god mode is active, reach stacker move costs and quay crane import unload costs are not deducted.

