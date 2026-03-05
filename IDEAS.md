# Sparky -- Feature Ideas

## New Components
- **Capacitor** -- 2-pin, spans like a resistor. Stores charge, could show charge/discharge animation in simulation
- **Toggle switch** -- like a button but stays on/off when clicked instead of momentary press
- **Potentiometer** -- 3-pin variable resistor. User drags a slider to change resistance. Great for teaching voltage dividers
- **Seven-segment display** -- 10 pins, lights up individual segments based on which ones get current. Visually impressive
- **Motor** -- 2-pin, spins a 3D propeller when current flows. Simple but fun
- **Speaker/piezo** -- like buzzer but with tone control based on circuit values

## AI / Backend
- **Conversation memory** -- [DONE] Sparky remembers the chat within a session
- **Multi-turn tool calling** -- after building, Sparky verifies the circuit by requesting simulation results and suggesting fixes
- **Explain mode** -- user clicks any component and Sparky explains what it does, what it's connected to, and why
- **Challenge mode** -- Sparky gives the user a circuit to build ("wire up an LED with a button") and grades their work
- **Debug mode** -- "Why isn't my LED lighting up?" Sparky checks for common mistakes (backwards LED, missing ground, no resistor)
- **Circuit templates** -- pre-built starting circuits users can load and modify (traffic light, alarm, etc.)

## 3D / Interaction
- **Undo / redo** -- ctrl+Z / ctrl+Y to step back and forward through actions
- **Duplicate component** -- select + ctrl+D to copy a component to a nearby position
- **Wire colors auto-assigned** -- power wires red, ground wires black, signal wires auto-pick distinct colors
- **Wire routing** -- wires that bend around components instead of going straight through them
- **Snap-to-hole preview** -- show a ghost of the component before placing it so users see exactly where it lands
- **Component labels** -- small floating labels on hover showing component values (e.g. "220 ohm", "Red LED")
- **Multimeter tool** -- click two points and see the voltage / connectivity between them
- **Zoom to fit** -- button that frames the entire circuit nicely

## Simulation
- **Current flow animation** -- animated dots flowing through wires when simulation runs. Makes "electricity is flowing" click visually
- **Voltage labels** -- hover a wire or rail during simulation to see the voltage at that point
- **Voltage color map** -- wires and rails glow different colors based on voltage level
- **Short circuit warning** -- flash the screen red or show a spark animation when there's no resistance in the path
- **Component failure** -- LED without a resistor burns out with a puff of smoke (teaches why resistors matter)

## Community / Sparks
- **Share via link** -- generate a shareable URL for any circuit
- **Remix** -- open someone else's circuit and fork it
- **Upvote / featured** -- community voting on best circuits
- **Export to image** -- screenshot the 3D view as a PNG for sharing

## Quality of Life
- **Dark mode** -- toggle between light and dark themes
- **Keyboard shortcuts help** -- overlay showing all available hotkeys
- **Mobile touch support** -- pinch to zoom, tap to place
- **Export / import .sparky files** -- save circuits locally as files
- **Guided tutorial** -- first-time walkthrough that teaches the basics step by step

## Priority picks (highest impact for effort)
1. Undo/redo
2. Current flow animation
3. Capacitor + toggle switch
4. Challenge mode
5. Dark mode
