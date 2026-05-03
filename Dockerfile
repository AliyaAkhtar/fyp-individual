FROM node:18

# Install tesseract
RUN apt-get update && apt-get install -y tesseract-ocr

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "index.js"]