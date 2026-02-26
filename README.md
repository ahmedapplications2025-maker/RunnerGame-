# ⚡ Speed Runner Pro

لعبة Endless Runner ثنائية الأبعاد احترافية مبنية بـ HTML5 + Vanilla JS

## 🚀 كيفية التشغيل

افتح `index.html` في أي متصفح حديث — أو شغّل على localhost:
```bash
# Python
python -m http.server 8080

# Node.js
npx serve .
```
ثم افتح: `http://localhost:8080`

## 🎮 أزرار التحكم

| الزر         | الوظيفة        |
|-------------|----------------|
| `Space / ↑` | قفز            |
| `↓ / S`     | انزلاق         |
| `P / Esc`   | إيقاف مؤقت    |
| `Ctrl+D`    | وضع المطور    |
| لمس ↑       | قفز (موبايل)  |
| لمس ↓       | انزلاق (موبايل)|

## 📦 هيكل المشروع

```
RunnerGame/
├── index.html          ← الصفحة الرئيسية
├── style.css           ← كل التنسيقات
├── game.js             ← المحرك الكامل (16 كلاس/نظام)
├── manifest.json       ← PWA manifest
├── service-worker.js   ← Offline support
├── assets/             ← صور اللعبة
├── icons/              ← أيقونات PWA
├── sounds/             ← ملفات الصوت
├── Scripts/            ← توثيق الأنظمة
├── Prefabs/            ← العناصر الجاهزة
├── Characters/         ← مجلد الشخصيات
├── Animations/         ← مجلد الأنيميشن
└── Textures/           ← مجلد التكسشر
```

## 🛠️ الأنظمة المدمجة

- ✅ Delta Time + requestAnimationFrame
- ✅ Object Pooling (لا GC spikes)
- ✅ Particle System
- ✅ Parallax Background
- ✅ Progressive Difficulty
- ✅ Anti-Cheat (encoded localStorage)
- ✅ PWA (قابل للتثبيت)
- ✅ Offline Mode (Service Worker)
- ✅ Dark/Light Mode
- ✅ FPS Counter (Ctrl+D)
- ✅ Dev Mode + Hitbox visualizer
- ✅ Touch Controls
- ✅ Achievements System (8 إنجازات)
- ✅ Shop System
- ✅ Leaderboard (أفضل 10)
- ✅ Power-Ups (4 أنواع)
- ✅ Smart Spawn (يمنع المستحيل)
