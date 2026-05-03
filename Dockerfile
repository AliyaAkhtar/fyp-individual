# # FROM node:18

# # WORKDIR /app

# # COPY package*.json ./
# # RUN npm install

# # COPY . .

# # # install OCR dependency (if using Tesseract OCR)
# # RUN apt-get update && apt-get install -y tesseract-ocr

# # EXPOSE 10000

# # CMD ["npm", "start"]


# FROM node:18

# # Install Python + pip + system deps
# RUN apt-get update && apt-get install -y \
#     python3 \
#     python3-pip \
#     tesseract-ocr

# WORKDIR /app

# COPY package*.json ./
# RUN npm install

# # Install Python libraries directly (since no requirements.txt)
# RUN pip3 install pandas joblib scikit-learn

# COPY . .

# EXPOSE 10000

# CMD ["npm", "start"]

FROM node:18

# Install Python + venv + OCR
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    tesseract-ocr

WORKDIR /app

COPY package*.json ./
RUN npm install

# Create virtual environment
RUN python3 -m venv /opt/venv

# Activate venv and install Python packages
RUN /opt/venv/bin/pip install pandas joblib scikit-learn

# Add venv to PATH
ENV PATH="/opt/venv/bin:$PATH"

COPY . .

EXPOSE 10000

CMD ["npm", "start"]