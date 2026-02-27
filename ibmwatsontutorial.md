Circuit Tutor Agent — Local Setup Guide
Prerequisites

Python 3.11 or higher
VS Code (recommended)


Step 1 — Clone/Get the Project Files
Make sure you have these two files in your project folder:

test.py
.env


Step 2 — Create the Virtual Environment
Open a terminal in the project folder and run:
python3.11 -m venv .venv
source .venv/bin/activate

Windows: use .venv\Scripts\activate instead


Step 3 — Install Dependencies
pip install ibm-watsonx-ai python-dotenv

Step 4 — Fill in the .env File
Create a .env file in the project root with these values:
WATSONX_APIKEY=***REDACTED_API_KEY***
WATSONX_URL=https://us-south.ml.cloud.ibm.com
WATSONX_PROJECT_ID=***REDACTED_PROJECT_ID***

Step 5 — Select the Python Interpreter in VS Code

Press Cmd + Shift + P (Mac) or Ctrl + Shift + P (Windows)
Type Python: Select Interpreter
Select .venv (3.11.x) from the list


Step 6 — Run the Script
python test.py
You should see the agent responding to three circuit questions in the terminal.