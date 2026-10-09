// Pack screen: screen capture, measuring and floating helpers that use modern browser APIs. Default category: screen.
export const cat = 'screen'
export default [
  { id: 'screenshot-tool', name: 'Screenshot & annotate', desc: 'Capture your screen, crop, draw arrows and text, then download.', icon: 'camera', tags: 'screenshot capture annotate markup crop blur arrow', ready: true },
  { id: 'color-picker', ready: true, name: 'Screen color picker', desc: 'Pick any pixel on your screen and get HEX, RGB and HSL.', icon: 'pipette', also: ['dev', 'image'], tags: 'eyedropper color picker hex' },
  { id: 'pixel-ruler', ready: true, name: 'Pixel ruler', desc: 'Capture the screen and measure distances and coordinates in pixels.', icon: 'ruler', also: ['dev'], tags: 'measure pixels coordinates' },
  { id: 'screen-ruler', ready: true, name: 'On-screen ruler (cm / inch)', desc: 'A real-size ruler calibrated to your screen.', icon: 'ruler-dimension-line', tags: 'ruler cm inch measure' },
  { id: 'screen-magnifier', ready: true, name: 'Screen magnifier', desc: 'Capture the screen and inspect it with a zoom lens.', icon: 'zoom-in', tags: 'magnify zoom lens' },
  { id: 'floating-notepad', ready: true, name: 'Always-on-top notepad', desc: 'A notepad that floats above your other windows.', icon: 'sticky-note', also: ['personal'], tags: 'notes floating picture in picture' },
  { id: 'floating-calculator', ready: true, name: 'Floating calculator', desc: 'A calculator that stays on top of other windows.', icon: 'calculator', also: ['calc'], tags: 'calculator floating pip' },
  { id: 'clipboard-history', ready: true, name: 'Clipboard history', desc: 'Keep a searchable history of what you copy and paste here.', icon: 'clipboard-list', tags: 'clipboard history paste' },
  { id: 'keyboard-tester', ready: true, name: 'Keyboard tester', desc: 'Test every key on your keyboard and see key codes.', icon: 'keyboard', also: ['dev'], tags: 'keyboard test keys keycode' },
  { id: 'screen-test', ready: true, name: 'Dead pixel & screen test', desc: 'Full-screen color tests for dead pixels, bleed and uniformity.', icon: 'monitor', tags: 'dead pixel monitor test' },
  { id: 'webcam-mic-test', ready: true, name: 'Webcam & mic test', desc: 'Check your camera and microphone before a call.', icon: 'webcam', also: ['media'], tags: 'camera microphone test' },
  { id: 'teleprompter', ready: true, name: 'Teleprompter', desc: 'Scroll your script at a steady speed for videos and talks.', icon: 'scroll-text', also: ['career', 'media'], tags: 'teleprompter script autocue' },
  { id: 'mouse-tester', name: 'Mouse tester', desc: 'Test every mouse button, the wheel and double clicks, and measure click speed.', icon: 'mouse', also: ['dev'], tags: 'mouse test buttons double click scroll wheel cps polling rate', ready: true },
  { id: 'gamepad-tester', name: 'Gamepad tester', desc: 'See every button, trigger and stick of your controller live, and check for stick drift.', icon: 'gamepad-2', also: ['dev'], tags: 'gamepad controller joystick xbox playstation drift buttons rumble', ready: true },
]
