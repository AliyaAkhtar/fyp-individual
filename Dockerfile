FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# install OCR dependency (if using Tesseract OCR)
RUN apt-get update && apt-get install -y tesseract-ocr

EXPOSE 10000

CMD ["npm", "start"]