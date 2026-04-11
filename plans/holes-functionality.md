vite + react, typescript, tailwind css v4, shadcn-ui. i have that fenestration internal software. It has different internal tools, currently we will tackle and create a plan for a new functionality for the sheet metal internal tool. It is a tool that lets user 'draw' .DXF sheet metal part design really fast, leveraging tanstack hotkeys. Currently we use WASD or the Arrow keys, to select the respectful top, left, bottom or right side. then by pressing F we add a FLANGE, and by pressing Z we add an inner FREZ (bending line) to the inside. By adding flange or inner frez line with the button F or Z we can directly assign length so we position the flange or inner FREZ line accordingly. When a side is selected lets say the bottom side, and we create 3 FLANGES using the F, they appear as F1, F2, F3, and then we can actually select a specific one using the CTRL+NUMBER like CTRL+2 will select the F2. Respectfully a keyboard sequence like:
W, F50, F30, Z50, F20; 

Will select top side, add F1[50mm], F2[30mm], Z3[50mm] and F4[20mm].
Then user can press CTRL+3 to select the Z3 specifically or CTRL+2 to select the F2. 

And this is where the new function is coming: I Want to allow user to add drainage holes (vertical horizontal lines), or just circular holes and let me explain further how it MUST work exactly. 
So right now for the sheet-metal internal tool we have that settings icon button in the app navbar, when clicked it opens a dialog containing 2 tabs, project defaults and DXF export. 

we will be assigning some modifiable defaults in the settings specifically for the new HOLES functionality. 
The HOLES functionality has to have:
- INNER or OUTER switch.
- HORIZONTAL or VERTICAL switch.
- side offset (measured from the sides)
- end offset (measured from the INNER or OUTER)

the SIDE and END offsets are ALWAYS measured based on the orientation of the HOLES lines themselves, not the orientation of the horizontal or vertical option! 

Let me provide some examples in ASCII so you can understand better:
1. Example with these settings:

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
      │                      │
      │                      │
      └──────────────────────┘