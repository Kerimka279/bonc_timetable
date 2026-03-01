const express = require('express');
const ics = require('ics');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = 3000;

async function fetchSchedule() {
  const url = 'https://www.sut.ru/studentu/raspisanie/raspisanie-zanyatiy-studentov-ochnoy-i-vecherney-form-obucheniya?group=56656';
  
  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    const $ = cheerio.load(data);
    const parsedLessons = [];
    const currentYear = 2026; 

    const dates = [];
    $('.vt244a > div').each((i, el) => {
      const text = $(el).text().trim();
      const match = text.match(/(\d{2})\.(\d{2})/);
      if (match) {
        dates.push({ day: parseInt(match[1], 10), month: parseInt(match[2], 10) });
      }
    });

    $('.vt244b > .vt244').each((rowIndex, rowEl) => {
      const timeText = $(rowEl).find('> .vt239').first().text();
      const times = timeText.match(/\d{2}:\d{2}/g);
      if (!times || times.length < 2) return;

      const [startHour, startMinute] = times[0].split(':').map(Number);
      const [endHour, endMinute] = times[1].split(':').map(Number);

      let durationHours = endHour - startHour;
      let durationMinutes = endMinute - startMinute;
      if (durationMinutes < 0) { durationHours -= 1; durationMinutes += 60; }

      $(rowEl).find('.rasp-day').each((dayIndex, dayEl) => {
        const lessonEl = $(dayEl).find('.vt258');
        if (lessonEl.length > 0) {
          
          let title = lessonEl.find('.vt240').text().trim().replace(/\s+/g, ' ');

          // 1. Пропускаем физкультуру
          if (title.toLowerCase().includes('физической культуре')) return;

          // 2. Укорачиваем Иностранный язык
          if (title.toLowerCase().includes('иностранный язык')) {
            title = 'Английский язык';
          }

          let teacher = lessonEl.find('.teacher').attr('title');
          teacher = teacher ? teacher.replace('; ', '').trim() : lessonEl.find('.teacher').text().trim();
          
          // 3. Вытаскиваем аудиторию и корпус
          let roomFull = lessonEl.find('.vt242').text().trim().replace(/\s+/g, ' ');
          // Из строки "ауд.: 322; Б22/2" вытаскиваем "322" и "2"
          const roomMatch = roomFull.match(/ауд\.:\s*([\w\d]+)/);
          const korpusMatch = roomFull.match(/Б22\/(\d+)/);
          
          let roomInfo = '';
          if (roomMatch) roomInfo += `ауд. ${roomMatch[1]}`;
          if (korpusMatch) roomInfo += `, к. ${korpusMatch[1]}`;

          const type = lessonEl.find('.vt243').text().trim();
          const date = dates[dayIndex];

          if (date) {
            parsedLessons.push({
              // Добавляем инфо об аудитории прямо в заголовок
              title: `${title}${roomInfo ? ' (' + roomInfo + ')' : ''}`,
              description: `Тип: ${type} | Преподаватель: ${teacher}`,
              start: [currentYear, date.month, date.day, startHour, startMinute],
              duration: { hours: durationHours, minutes: durationMinutes },
              rawType: type.toLowerCase()
            });
          }
        }
      });
    });
    return parsedLessons;
  } catch (error) {
    console.error('Ошибка:', error.message);
    return [];
  }
}

app.get('/schedule/:category.ics', async (req, res) => {
  const category = req.params.category;
  const lessons = await fetchSchedule();
  if (lessons.length === 0) return res.status(500).send('Ошибка парсинга');

  let filtered = lessons;
  if (category === 'lectures') filtered = lessons.filter(l => l.rawType.includes('лекци'));
  else if (category === 'practices') filtered = lessons.filter(l => l.rawType.includes('практич'));
  else if (category === 'labs') filtered = lessons.filter(l => l.rawType.includes('лабораторн'));

  const cleanLessons = filtered.map(({ rawType, ...rest }) => rest);
  const { error, value } = ics.createEvents(cleanLessons);
  
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${category}.ics"`);
  res.send(value || 'BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR');
});

app.listen(PORT, () => console.log(`Сервер на порту ${PORT}`));