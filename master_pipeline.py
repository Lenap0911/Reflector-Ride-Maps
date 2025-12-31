#!/usr/bin/env python3
"""
Master Pipeline for Reflector Ride Maps
Runs the complete data processing workflow:
1. CSV to GeoJSON conversion
2. Speed calculation from sensor data
3. Road segment averaging and consolidation
4. Traffic light analysis generation
5. PMTiles generation for web visualization
6. Cleanup of processed CSV files

Usage: python master_pipeline.py
"""

import subprocess
import sys
import os
import json
from pathlib import Path
import time
import shutil

# ANSI color codes for pretty output
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    END = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'

def print_header(text):
    """Print a section header"""
    print(f"\n{Colors.HEADER}{Colors.BOLD}{'=' * 70}{Colors.END}")
    print(f"{Colors.HEADER}{Colors.BOLD}{text.center(70)}{Colors.END}")
    print(f"{Colors.HEADER}{Colors.BOLD}{'=' * 70}{Colors.END}\n")

def print_step(step_num, step_name):
    """Print a step header"""
    print(f"\n{Colors.CYAN}{Colors.BOLD}[STEP {step_num}] {step_name}{Colors.END}")
    print(f"{Colors.CYAN}{'─' * 70}{Colors.END}")

def print_success(text):
    """Print success message"""
    print(f"{Colors.GREEN}✅ {text}{Colors.END}")

def print_error(text):
    """Print error message"""
    print(f"{Colors.RED}❌ {text}{Colors.END}")

def print_warning(text):
    """Print warning message"""
    print(f"{Colors.YELLOW}⚠️  {text}{Colors.END}")

def print_info(text):
    """Print info message"""
    print(f"{Colors.BLUE}ℹ️  {text}{Colors.END}")

def check_prerequisites():
    """Check if all required tools and files exist"""
    print_step("0", "Checking Prerequisites")
    
    issues = []
    
    # Check if csv_data directory exists
    if not Path("csv_data").exists():
        issues.append("csv_data/ directory not found")
        print_error("csv_data/ directory not found")
    else:
        csv_files = list(Path("csv_data").glob("*.csv"))
        if not csv_files:
            issues.append("No CSV files found in csv_data/")
            print_warning("No CSV files found in csv_data/")
        else:
            print_success(f"Found {len(csv_files)} CSV file(s) in csv_data/")
    
    # Check if Python scripts exist
    scripts = [
        "csv_to_geojson_converter.py",
        "integrated_processor.py",
        "road_averaging.py",
        "generate_traffic_light_analysis.py",
        "build_pmtiles.py"
    ]
    
    for script in scripts:
        if not Path(script).exists():
            issues.append(f"{script} not found")
            print_error(f"{script} not found")
        else:
            print_success(f"Found {script}")
    
    # Check for traffic lights file
    traffic_light_files = [
        "traffic_lights.json",
        "verkeerslichten.geojson",
        "traffic_lights.geojson",
        "data/verkeerslichten.geojson",
        "data/traffic_lights.json"
    ]
    found_traffic_lights = False
    for tl_file in traffic_light_files:
        if Path(tl_file).exists():
            print_success(f"Found traffic lights file: {tl_file}")
            found_traffic_lights = True
            break
    
    if not found_traffic_lights:
        print_warning("Traffic lights file not found (optional)")
        print_info("Traffic light analysis will be skipped")
    
    # Check if tippecanoe is installed
    try:
        result = subprocess.run(
            ["tippecanoe", "--version"],
            capture_output=True,
            text=True,
            check=False
        )
        if result.returncode == 0:
            print_success("tippecanoe is installed")
        else:
            issues.append("tippecanoe not found")
            print_error("tippecanoe not found")
            print_info("Install with: brew install tippecanoe (macOS)")
    except FileNotFoundError:
        issues.append("tippecanoe not found")
        print_error("tippecanoe not found")
        print_info("Install with: brew install tippecanoe (macOS)")
    
    return len(issues) == 0, issues

def run_command(command, description):
    """Run a shell command and handle errors"""
    print_info(f"Running: {description}")
    print(f"{Colors.BOLD}Command:{Colors.END} {' '.join(command)}\n")
    
    start_time = time.time()
    
    try:
        result = subprocess.run(
            command,
            check=True,
            capture_output=False,
            text=True
        )
        
        elapsed = time.time() - start_time
        print_success(f"{description} completed in {elapsed:.2f}s")
        return True
        
    except subprocess.CalledProcessError as e:
        print_error(f"{description} failed!")
        print_error(f"Exit code: {e.returncode}")
        return False
    except FileNotFoundError:
        print_error(f"Command not found: {command[0]}")
        return False

def count_files(directory, pattern):
    """Count files matching a pattern in a directory"""
    if not Path(directory).exists():
        return 0
    return len(list(Path(directory).rglob(pattern)))

def cleanup_csv_files():
    """Delete processed CSV files"""
    print_step("6", "Cleaning Up Processed CSV Files")
    
    csv_dir = Path("csv_data")
    if not csv_dir.exists():
        print_warning("csv_data/ directory not found")
        return
    
    csv_files = list(csv_dir.glob("*.csv"))
    
    if not csv_files:
        print_info("No CSV files to clean up")
        return
    
    print_info(f"Found {len(csv_files)} CSV file(s) to delete")
    
    # List files to be deleted
    for csv_file in csv_files:
        print(f"  📄 {csv_file.name}")
    
    # Confirm deletion
    try:
        response = input(f"\n{Colors.YELLOW}Delete these {len(csv_files)} CSV file(s)? (y/N): {Colors.END}").lower()
        if response != 'y':
            print_warning("CSV cleanup skipped")
            return
    except KeyboardInterrupt:
        print("\n")
        print_warning("CSV cleanup cancelled")
        return
    
    # Delete files
    deleted_count = 0
    failed_count = 0
    
    for csv_file in csv_files:
        try:
            csv_file.unlink()
            deleted_count += 1
            print_success(f"Deleted {csv_file.name}")
        except Exception as e:
            failed_count += 1
            print_error(f"Failed to delete {csv_file.name}: {e}")
    
    # Summary
    if deleted_count > 0:
        print_success(f"Deleted {deleted_count} CSV file(s)")
    if failed_count > 0:
        print_warning(f"Failed to delete {failed_count} file(s)")

def print_summary():
    """Print a summary of generated files"""
    print_header("PIPELINE SUMMARY")
    
    # Count files
    csv_count = count_files("csv_data", "*.csv")
    geojson_clean_count = count_files("sensor_data", "*_clean.geojson")
    geojson_processed_count = count_files("processed_sensor_data", "*_processed.geojson")
    road_segments_exists = Path("road_segments_averaged.json").exists()
    traffic_analysis_exists = Path("traffic_lights_analyzed.json").exists()
    pmtiles_exists = Path("trips.pmtiles").exists()
    
    print(f"{Colors.BOLD}Input Files:{Colors.END}")
    print(f"  📄 CSV files remaining: {csv_count}")
    
    print(f"\n{Colors.BOLD}Generated Files:{Colors.END}")
    print(f"  🗺️  Cleaned GeoJSON: {geojson_clean_count}")
    print(f"  ⚡ Processed GeoJSON: {geojson_processed_count}")
    print(f"  🛣️  Road Segments: {'✅ Yes' if road_segments_exists else '❌ No'}")
    print(f"  🚦 Traffic Light Analysis: {'✅ Yes' if traffic_analysis_exists else '❌ No'}")
    print(f"  📦 PMTiles: {'✅ Yes' if pmtiles_exists else '❌ No'}")
    
    if road_segments_exists:
        try:
            with open("road_segments_averaged.json") as f:
                data = json.load(f)
                segment_count = len(data.get('features', []))
                print(f"     Segments: {segment_count}")
        except:
            pass
    
    if pmtiles_exists:
        pmtiles_size = Path("trips.pmtiles").stat().st_size / (1024 * 1024)
        print(f"     Size: {pmtiles_size:.2f} MB")
    
    print(f"\n{Colors.BOLD}Output Directories:{Colors.END}")
    print(f"  📁 sensor_data/")
    print(f"  📁 processed_sensor_data/")
    
    if pmtiles_exists:
        print(f"\n{Colors.GREEN}{Colors.BOLD}✅ Pipeline completed successfully!{Colors.END}")
        print(f"\n{Colors.CYAN}Next steps:{Colors.END}")
        print(f"  1. Commit changes: git add . && git commit -m 'Update trip data'")
        print(f"  2. Push to GitHub: git push")
        print(f"  3. View at: https://tomvanarman.github.io/Reflector-Ride-Maps/")
        if road_segments_exists:
            print(f"  4. Load 'road_segments_averaged.json' in your map to see consolidated segments!")
        if traffic_analysis_exists:
            print(f"  5. Enable 'Traffic Light Analysis' in the web interface to see insights!")
    else:
        print(f"\n{Colors.YELLOW}{Colors.BOLD}⚠️  Pipeline completed with issues{Colors.END}")

def check_python_packages():
    """Check if required Python packages are installed"""
    print_info("Checking Python packages...")
    
    required_packages = ['numpy', 'geojson']
    missing_packages = []
    
    for package in required_packages:
        try:
            __import__(package)
            print_success(f"Package '{package}' is installed")
        except ImportError:
            missing_packages.append(package)
            print_error(f"Package '{package}' is NOT installed")
    
    if missing_packages:
        print_error(f"\nMissing packages: {', '.join(missing_packages)}")
        print_info(f"Install with: pip3 install {' '.join(missing_packages)}")
        print_info(f"Or: python3 -m pip install {' '.join(missing_packages)}")
        return False
    
    return True

def main():
    """Main pipeline execution"""
    print_header("REFLECTOR RIDE MAPS - MASTER PIPELINE")
    print(f"{Colors.BOLD}This will process all CSV files and regenerate map data{Colors.END}\n")
    
    # Check Python interpreter and packages
    print_info(f"Using Python: {sys.executable}")
    print_info(f"Python version: {sys.version.split()[0]}\n")
    
    if not check_python_packages():
        print_error("\nRequired Python packages are missing!")
        sys.exit(1)
    
    # Check prerequisites
    prereqs_ok, issues = check_prerequisites()
    
    if not prereqs_ok:
        print_error("Prerequisites check failed!")
        print("\nIssues found:")
        for issue in issues:
            print(f"  • {issue}")
        print("\nPlease fix these issues and try again.")
        sys.exit(1)
    
    print_success("All prerequisites met!\n")
    
    # Confirm before proceeding
    try:
        response = input(f"{Colors.YELLOW}Continue with pipeline? (y/N): {Colors.END}").lower()
        if response != 'y':
            print("\nPipeline cancelled.")
            sys.exit(0)
    except KeyboardInterrupt:
        print("\n\nPipeline cancelled.")
        sys.exit(0)
    
    total_start = time.time()
    
    # Step 1: CSV to GeoJSON
    print_step("1", "Converting CSV to GeoJSON")
    step1_success = run_command(
        [sys.executable, "csv_to_geojson_converter.py"],
        "CSV to GeoJSON conversion"
    )
    
    if not step1_success:
        print_error("Step 1 failed. Aborting pipeline.")
        sys.exit(1)
    
    # Step 2: Calculate speeds
    print_step("2", "Calculating Speeds from Sensor Data")
    step2_success = run_command(
        [sys.executable, "integrated_processor.py"],
        "Speed calculation"
    )
    
    if not step2_success:
        print_error("Step 2 failed. Aborting pipeline.")
        sys.exit(1)
    
    # Step 3: Average road segments
    print_step("3", "Averaging and Consolidating Road Segments")
    step3_success = run_command(
        [sys.executable, "road_averaging.py"],
        "Road segment averaging"
    )
    
    if not step3_success:
        print_warning("Step 3 failed, but continuing with pipeline...")
    
    # Step 4: Generate traffic light analysis
    print_step("4", "Generating Traffic Light Analysis")
    
    # Check if traffic lights file exists
    traffic_light_files = [
        "traffic_lights.json",
        "verkeerslichten.geojson",
        "traffic_lights.geojson",
        "data/verkeerslichten.geojson",
        "data/traffic_lights.json"
    ]
    has_traffic_lights = any(Path(f).exists() for f in traffic_light_files)
    
    if has_traffic_lights:
        step4_success = run_command(
            [sys.executable, "generate_traffic_light_analysis.py"],
            "Traffic light analysis"
        )
        
        if not step4_success:
            print_warning("Step 4 failed, but continuing with pipeline...")
    else:
        print_warning("No traffic lights file found - skipping traffic light analysis")
        print_info("Add traffic_lights.json or verkeerslichten.geojson to enable this feature")
        step4_success = True  # Don't fail pipeline if optional step is skipped
    
    # Step 5: Build PMTiles
    print_step("5", "Building PMTiles for Web")
    step5_success = run_command(
        [sys.executable, "build_pmtiles.py"],
        "PMTiles generation"
    )
    
    if not step5_success:
        print_error("Step 5 failed. Aborting pipeline.")
        sys.exit(1)
    
    # Step 6: Cleanup CSV files (only if all previous steps succeeded)
    if step1_success and step2_success and step5_success:
        cleanup_csv_files()
    else:
        print_warning("Skipping CSV cleanup due to pipeline errors")
    
    # Print summary
    total_elapsed = time.time() - total_start
    print(f"\n{Colors.BOLD}Total time: {total_elapsed:.2f}s{Colors.END}")
    print_summary()

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n\n{Colors.YELLOW}Pipeline interrupted by user{Colors.END}")
        sys.exit(1)
    except Exception as e:
        print(f"\n{Colors.RED}Unexpected error: {e}{Colors.END}")
        sys.exit(1)