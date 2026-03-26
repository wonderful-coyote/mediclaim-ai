# 1. Get a computer that already has Python installed
FROM python:3.9

# 2. Make a master folder inside the supercomputer called /app
WORKDIR /app

# 3. Copy EVERYTHING from your laptop into the supercomputer
COPY . /app

# 4. Go directly into the backend folder
WORKDIR /app/backend

# 5. Read the grocery list and install the tools
RUN pip install --no-cache-dir -r requirements.txt

# 6. Hugging Face requires all apps to use port 7860, so we open that door
EXPOSE 7860

# 7. Turn on the Brain!
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]