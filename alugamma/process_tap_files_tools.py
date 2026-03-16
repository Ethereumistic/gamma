#!/usr/bin/env python3
"""
TAP to NC File Processor
Processes .tap files by:
1. Deleting the first 5 rows
2. Removing useless machine return rows between toolpaths (G91G28Z0, G49H0, G28X0Y0)
3. Adding 'G0' after 'G43' for all toolpaths
4. Saving as .nc file
"""

import os
import re
from pathlib import Path


def process_tap_file(input_file_path, output_file_path=None):
    """
    Process a single .tap file
    
    Args:
        input_file_path: Path to the input .tap file
        output_file_path: Path to the output .nc file (optional, auto-generated if None)
    
    Returns:
        True if successful, False otherwise
    """
    try:
        # Read the input file
        with open(input_file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        # Check if file has enough lines
        if len(lines) < 5:
            print(f"Error: File {input_file_path} has less than 5 lines. Skipping...")
            return False
        
        # Delete the first 5 rows
        processed_lines = lines[5:]
        
        # Remove useless rows before toolpaths (excluding the end of the file)
        # We protect the last 15 lines just to be safe so we don't remove 
        # the final machine return commands before M30.
        protected_start_idx = len(processed_lines) - 15
        if protected_start_idx < 0:
            protected_start_idx = 0
            
        final_lines = []
        removed_count = 0
        for i, line in enumerate(processed_lines):
            is_useless = False
            if i < protected_start_idx:
                stripped = line.strip()
                no_space = stripped.replace(" ", "")
                if re.match(r'^(?:N\d+)?G91G28Z0$', no_space) or \
                   re.match(r'^(?:N\d+)?G49H0$', no_space) or \
                   re.match(r'^(?:N\d+)?G28X0Y0$', no_space):
                    is_useless = True
                    removed_count += 1
                    print(f"Removed useless row: {stripped}")
            
            if not is_useless:
                final_lines.append(line)
                
        processed_lines = final_lines
        if removed_count > 0:
            print(f"Removed {removed_count} useless toolpath transition rows.")
        
        # Find all G43 occurrences
        # The G43 we're looking for is usually after lines starting with 'N' and containing '('
        g43_modified = False
        
        for i, line in enumerate(processed_lines):
            # Look for G43 in non-comment lines (lines that don't contain '(')
            if 'G43' in line and 'G43G0' not in line and '(' not in line:
                # Replace G43 with G43G0
                processed_lines[i] = line.replace('G43', 'G43G0', 1)
                g43_modified = True
                print(f"Modified line: {line.strip()} -> {processed_lines[i].strip()}")
        
        if not g43_modified:
            print(f"Warning: No G43 found in {input_file_path}")
        
        # Generate output file path if not provided
        if output_file_path is None:
            input_path = Path(input_file_path)
            output_file_path = input_path.parent / f"{input_path.stem}.nc"
        
        # Write the processed content to the output file
        with open(output_file_path, 'w', encoding='utf-8') as f:
            f.writelines(processed_lines)
        
        print(f"✓ Successfully processed: {input_file_path} -> {output_file_path}")
        return True
        
    except Exception as e:
        print(f"✗ Error processing {input_file_path}: {str(e)}")
        return False


def process_single_file():
    """Process a single file"""
    file_path = input("Enter the full path to the .tap file: ").strip().strip('"')
    
    if not os.path.exists(file_path):
        print(f"Error: File not found: {file_path}")
        return
    
    if not file_path.lower().endswith('.tap'):
        print("Warning: File doesn't have .tap extension")
        proceed = input("Do you want to continue anyway? (y/n): ").strip().lower()
        if proceed != 'y':
            return
    
    process_tap_file(file_path)


def process_multiple_files():
    """Process multiple files in a directory"""
    dir_path = input("Enter the full path to the directory containing .tap files: ").strip().strip('"')
    
    if not os.path.exists(dir_path):
        print(f"Error: Directory not found: {dir_path}")
        return
    
    if not os.path.isdir(dir_path):
        print(f"Error: {dir_path} is not a directory")
        return
    
    # Find all .tap files in the directory
    tap_files = list(Path(dir_path).glob("*.tap"))
    
    if not tap_files:
        print(f"No .tap files found in {dir_path}")
        return
    
    print(f"\nFound {len(tap_files)} .tap file(s):")
    for i, file in enumerate(tap_files, 1):
        print(f"  {i}. {file.name}")
    
    proceed = input(f"\nDo you want to process all {len(tap_files)} files? (y/n): ").strip().lower()
    if proceed != 'y':
        print("Operation cancelled")
        return
    
    print("\nProcessing files...")
    print("-" * 60)
    
    success_count = 0
    for tap_file in tap_files:
        if process_tap_file(tap_file):
            success_count += 1
    
    print("-" * 60)
    print(f"\nCompleted: {success_count}/{len(tap_files)} files processed successfully")


def main():
    """Main function"""
    print("=" * 60)
    print("TAP to NC File Processor (with toolpath optimization)")
    print("=" * 60)
    print("\nThis script will:")
    print("  1. Delete the first 5 rows")
    print("  2. Remove useless machine return rows between toolpaths")
    print("  3. Add 'G0' after 'G43' in all appropriate locations")
    print("  4. Save the output as a .nc file")
    print("\n" + "=" * 60)
    
    while True:
        print("\nSelect processing mode:")
        print("  1. Process a single file")
        print("  2. Process multiple files (batch)")
        print("  3. Exit")
        
        choice = input("\nEnter your choice (1/2/3): ").strip()
        
        if choice == '1':
            print("\n--- Single File Mode ---")
            process_single_file()
        elif choice == '2':
            print("\n--- Batch Processing Mode ---")
            process_multiple_files()
        elif choice == '3':
            print("\nExiting...")
            break
        else:
            print("Invalid choice. Please enter 1, 2, or 3.")
        
        print("\n" + "=" * 60)


if __name__ == "__main__":
    main()
