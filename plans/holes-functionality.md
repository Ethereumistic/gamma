vite + react, typescript, tailwind css v4, shadcn-ui. i have that fenestration internal software. It has different internal tools, currently we will tackle and create a plan for a new functionality for the sheet metal internal tool. It is a tool that lets user 'draw' .DXF sheet metal part design really fast, leveraging tanstack hotkeys. Currently we use WASD or the Arrow keys, to select the respectful top, left, bottom or right side. then by pressing F we add a FLANGE, and by pressing Z we add an inner FREZ (bending line) to the inside. By adding flange or inner frez line with the button F or Z we can directly assign length so we position the flange or inner FREZ line accordingly. When a side is selected lets say the bottom side, and we create 3 FLANGES using the F, they appear as F1, F2, F3, and then we can actually select a specific one using the CTRL+NUMBER like CTRL+2 will select the F2. Respectfully a keyboard sequence like:
W, F50, F30, Z50, F20; 

Will select top side, add F1[50mm], F2[30mm], Z3[50mm] and F4[20mm].
Then user can press CTRL+3 to select the Z3 specifically or CTRL+2 to select the F2. 

And this is where the new function is coming: I Want to allow user to add drainage holes (vertical horizontal lines), or just circular holes (if length is set to 0.001mm). The HOLES must be added to a new HOLES layer using yellow-500 color. Let me explain further how it MUST work exactly. 
So right now for the sheet-metal internal tool we have that settings icon button in the app navbar, when clicked it opens a dialog containing 2 tabs, project defaults and DXF export. 

we will be assigning some modifiable defaults in the settings specifically for the new HOLES functionality. 
The HOLES functionality has to have:
- INNER or OUTER switch
- HORIZONTAL or VERTICAL switch
- side offset (measured from the sides)
- end offset (measured from the INNER or OUTER)
- length

the SIDE and END offsets are ALWAYS measured based on the orientation of the HOLES lines themselves, not the orientation of the horizontal or vertical option! 

Let me provide some examples in ASCII so you can understand better, one character or row equals 25mm:
1. Example with these settings, selected TOP flange F1:
- OUTER
- HORIZONTAL
- SIDE: 25mm
- END: 25mm
- LENGTH: 25mm

      ┌──────────────────────┐
      │                      │
      │ ─                  ─ │
      │                      │
┌─────┬──────────────────────┬─────┐
│     │                      │     │
│     │                      │     │
│     │                      │     │
│     │                      │     │
│     │                      │     │
│     │                      │     │
└─────┴──────────────────────┴─────┘
      │                      │
      │                      │
      │                      │
      └──────────────────────┘
2. Example with these settings, selected LEFT flange, F1 (you can see here how the SIDE and END offsets are measured based on the orientation of the HOLES lines themselves, and the HOLES are positioned vertically even tho we have selected HORIZONTAL in the settings switch, that is because the selected flange is the LEFT one. ):
- OUTER
- HORIZONTAL
- SIDE: 50mm
- END: 25mm
- LENGTH: 25mm

      ┌──────────────────────┐
      │                      │
      │                      │
      │                      │
┌─────┬──────────────────────┬─────┐
│     │                      │     │
│     │                      │     │
│ |   │                      │     │
│ |   │                      │     │
│     │                      │     │
│     │                      │     │
└─────┴──────────────────────┴─────┘
      │                      │
      │                      │
      │                      │
      └──────────────────────┘

3. Example with these settings, selected BOTTOM flange, F1 (you can see here how the SIDE and END offsets are measured based on the orientation of the HOLES lines themselves, and the HOLES are positioned vertically since we have selected VERTICAL in the BOTTOM flange):
- OUTER
- VERTICAL
- SIDE: 25mm
- END: 75mm
- LENGTH: 25mm

      ┌──────────────────────┐
      │                      │
      │                      │
      │                      │
┌─────┬──────────────────────┬─────┐
│     │                      │     │
│     │                      │     │
│     │                      │     │
│     │                      │     │
│     │                      │     │
│     │                      │     │
└─────┴──────────────────────┴─────┘
      │                      │
      │   |                  │
      │   |                  │
      │                      │
      └──────────────────────┘

I basically want then user has selected Fn or Zn aka any flange on any side, to add the 2 HOLES to that sheet metal's selected flange or inner frez line. 

So the user will press W, F50, F30, F20. 
Then press CTRL+1 to select the F1. 
Then press H to add the HOLES using the current settings. 

And the user can continue with the keyboard sequence like: 

Z25, H ... 

And so on. 

This is the whole idea. 
Please write an in depth plan for that, in the plans folder so i can review it and provide it to another AI agent to implement in a simple and robust way.