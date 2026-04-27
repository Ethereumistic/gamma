import os

# Set the directory where your files are located
# Use "." for the current folder where the script is saved
directory = "."

for filename in os.listdir(directory):
    # Check if the file matches the expected pattern
    if filename.startswith("sheet_") and filename.endswith(".dxf"):
        try:
            # 1. Strip 'sheet_' and '.dxf' to get the number string
            # filename.split("_")[1] gives "1.dxf", then split(".") gives "1"
            number_part = filename.split("_")[1].split(".")[0]
            
            # 2. Convert to integer and subtract 1
            new_number = int(number_part) - 1
            
            # 3. Construct the new filename
            new_filename = f"{new_number}.dxf"
            
            # 4. Define full paths
            old_path = os.path.join(directory, filename)
            new_path = os.path.join(directory, new_filename)
            
            # 5. Rename the file
            os.rename(old_path, new_path)
            print(f"Renamed: {filename} -> {new_filename}")
            
        except (IndexError, ValueError) as e:
            print(f"Skipping {filename}: Could not parse number.")

print("Task complete.")