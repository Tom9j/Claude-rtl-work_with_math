# שינויים מול הריפו המקורי

הפאטץ' המקורי ([shraga100/claude-desktop-rtl-patch](https://github.com/shraga100/claude-desktop-rtl-patch)) מטפל מצוין בטקסט עברי/ערבי אבל לא מודע לקיומה של מתמטיקה. הריפו הזה מוסיף את הבא ל-`patch.ps1`:

## 1. הגנה על KaTeX/MathJax/MathML

קבועים: `MATH_SEL` חדש כולל את `.katex`, `.katex-display`, `.katex-mathml`, `.katex-html`, `mjx-container`, `.MathJax`, `math`, ו-`mjx-math`.

* `processText` ו-`processContainers` מדלגים על תת-עץ של מתמטיקה.
* `textWithoutCode` מתעלם מצמתי מתמטיקה בזיהוי כיוון.
* `forceMathLTR` חדש שמחיל `dir=ltr` ו-`unicode-bidi:isolate` על כל מכל מתמטיקה.

## 2. CSS חזק על כל פנים הנוסחה

KaTeX מפצל אופרטור בינארי לכמה `<span class="base">` שכנים — `display:inline-block`. ה-CSS המקורי הגן רק על המכלים העליונים, אבל ה-bases ירשו `direction:rtl` מהפסקה העברית. תוצאה: `m = k + 1` הופך ל-`1 + k = m`.

התיקון: כללי CSS עם wildcard descendant שמכריחים `direction:ltr` על כל אלמנט בתוך מכל מתמטיקה:

```css
.katex *, .katex-display *, mjx-container *, .MathJax *, math * { direction: ltr !important }
[dir="rtl"] .katex *, [dir="rtl"] mjx-container * { direction: ltr !important; unicode-bidi: isolate !important }
```

## 3. עיצוב נוסחאות display

* `.katex-display` ממורכז תמיד (בלי קשר לכיוון ההורה), עם `margin: 1em 0` ו-`overflow-x: auto` לנוסחאות רחבות.

## 4. עיצוב נוסחאות inline

* `display:inline-block` + `vertical-align:middle` כדי שלא יצופו מעל שורת הטקסט העברי.
* `white-space:nowrap` כדי שלא יישברו באמצע.
* `margin: 0 .15em` כשהן בתוך פסקת RTL.

## 5. עטיפת LTR runs בתווי isolate

כשמתמטיקה נכתבת כטקסט רגיל (לא KaTeX) — למשל `(j < n)` או `n - 1` — ה-Unicode BiDi Algorithm גורר את הסוגריים ואת האופרטורים לרמת ה-RTL ומסדר אותם הפוך.

פונקציה חדשה `bidiIsolateMathInTextNodes` עוברת על text nodes בתוך פסקאות RTL, מזהה תבניות מתמטיות (ביטוי עם אופרטור/סוגר/השוואה), ועוטפת אותן בתווי `U+2066` (LRI) ו-`U+2069` (PDI). הדפדפן מתייחס לקטע כיחידת bidi עצמאית עם כיוון LTR — אבל בלי לעקוף את React (אנחנו רק מעדכנים `nodeValue`, לא `innerHTML`).

הפונקציה idempotent (בודקת אם כבר יש LRI בקטע) כדי שלא תיכנס ללולאה עם ה-MutationObserver.

## 6. Tampermonkey userscript ל-Web

קובץ `claude-rtl.user.js` חדש: אותו payload בדיוק עטוף עם כותרת `// ==UserScript==` ו-`@match https://claude.ai/*`. מאפשר להפעיל את אותו תיקון על הוובסייט, שלא נתמך בכלל בפאטץ' המקורי.

---

כל שאר הלוגיקה — חילוץ asar, hash patching של `claude.exe`, החלפת הסרטיפיקט ב-`cowork-svc.exe`, ה-watcher האוטומטי, חתימת signature verification — נשארו בלי שינוי.
