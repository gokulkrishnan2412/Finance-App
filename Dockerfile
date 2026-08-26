# Finance-App — production-style container image
FROM python:3.11-slim

# Set working directory inside the container
WORKDIR /app

# Install Python dependencies first (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application (backend + frontend)
COPY . .

# Expose the Flask port
EXPOSE 5000

# Run the Flask app
# debug=False so the auto-reloader does NOT spawn a child process
# (avoids "Address already in use" leftovers inside the container)
CMD ["python3", "backend/app.py"]
