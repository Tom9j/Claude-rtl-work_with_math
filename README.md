# Claude RTL — Hebrew/Arabic + Math

תיקון RTL ל-Claude (Desktop ו-Web) שעובד נכון גם עם נוסחאות מתמטיות (KaTeX / MathJax / MathML), בנוסף לטקסט עברי וערבי.

זהו fork מתוקן של [shraga100/claude-desktop-rtl-patch](https://github.com/shraga100/claude-desktop-rtl-patch). הפאטץ' המקורי עשה עבודה מצוינת עם פסקאות עברית/ערבית, אבל שבר נוסחאות מתמטיות שמופיעות בתוך טקסט עברי. הריפו הזה מוסיף הגנה מלאה על מתמטיקה + תוסף Tampermonkey לגרסת ה-Web (`claude.ai`) שלא נתמך בפאטץ' המקורי.

> **English:** A patched fork of the original RTL solution for Claude Desktop, with proper handling of mixed-script math content (KaTeX, MathJax, MathML) and an additional Tampermonkey userscript for the web version at `claude.ai`.

---

## מה מתקן?

| בעיה בגרסה המקורית | התיקון פה |
|---|---|
| נוסחאות KaTeX מתהפכות בתוך פסקה עברית — `m = k + 1` הופך ל-`1 + k = m`, `n - 1` הופך ל-`1n -` | אכיפת `direction: ltr` רקורסיבית על כל צאצא של מכל מתמטיקה (`.katex *`, `mjx-container *`, וכו') |
| נוסחאות display (`$$...$$`) נדחקות שמאלה במקום להיות ממורכזות | מרכוז קבוע ל-`.katex-display` + `overflow-x:auto` לנוסחאות רחבות |
| מתמטיקה inline צפה מעל שורת הטקסט העברי | `display:inline-block` + `vertical-align:middle` |
| `(j < n)` או `n - 1` כטקסט רגיל (לא KaTeX) מסתדר רע בגלל ה-Unicode Bidi Algorithm | עטיפת LTR runs בתווי isolate (U+2066 / U+2069) כשהם בתוך פסקה RTL |
| לא תומך בכלל ב-`claude.ai` באתר | userscript ל-Tampermonkey עם אותה לוגיקה בדיוק |

## התקנה — Claude Desktop (Windows)

> **דרישות:** Windows 10/11, Claude Desktop מותקן כ-AppX (מ-Microsoft Store), Node.js ≥ 22.12 (לחילוץ asar), הרשאות אדמין.

מ-PowerShell **כאדמין**:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
irm https://raw.githubusercontent.com/TOM9J/Claude-rtl-work_with_math/main/patch.ps1 -OutFile "$env:TEMP\claude-rtl-patch.ps1"
& "$env:TEMP\claude-rtl-patch.ps1"
```

בחר `1` (Install). הסקריפט:
1. מחלץ את `app.asar`.
2. מזריק את ה-JS לכל קבצי `.vite\build\*.js`.
3. מארז מחדש ומעדכן את ה-hash בתוך `claude.exe`.
4. חותם מחדש בחתימה עצמית (כי השינוי בקובץ ה-binary שבר את החתימה המקורית).

**שים לב:** אם תפעיל את אופציה 4 (Auto Re-Patch), ה-watcher יוריד את הפאטץ' מ-**הריפו המקורי** (`shraga100/...`) בעדכוני Claude, לא מהריפו הזה. עד שאתקן גם את `watcher.ps1`, מומלץ להשאיר את ה-watcher במצב Disabled (אופציה 5) ולהריץ ידנית אחרי כל עדכון של Claude.

## התקנה — Claude Web (`claude.ai`)

1. התקן את התוסף **Tampermonkey** ([Chrome/Edge](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) / [Firefox](https://addons.mozilla.org/firefox/addon/tampermonkey/)).
2. פתח את הקובץ:
   ```
   https://raw.githubusercontent.com/TOM9J/Claude-rtl-work_with_math/main/claude-rtl.user.js
   ```
3. Tampermonkey יציע התקנה. אישור → רענון `claude.ai`.

## הסרה

מ-PowerShell אדמין:
```powershell
& "$env:TEMP\claude-rtl-patch.ps1"
# בחר 2 (Restore Original State)
```
לוובסייט — מחק את ה-script מ-Tampermonkey.

## קרדיט

הפאטץ' המקורי, כולל כל הלוגיקה של ASAR repackaging, hash patching, ו-binary cert swapping ב-`cowork-svc.exe`, מאת **[@shraga100](https://github.com/shraga100)**. הריפו הזה מוסיף תיקוני מתמטיקה ל-JS המוזרק ותוסף Tampermonkey. רשיון MIT (תואם למקורי).

## רשיון

[MIT](LICENSE).
