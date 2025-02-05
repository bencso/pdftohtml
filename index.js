import fs from "fs";
import * as pdfjsLib from 'pdfjs-dist';

const pdfBuffer = new Uint8Array(fs.readFileSync("sample.pdf"));
const loadingTask = pdfjsLib.getDocument(pdfBuffer);

// Konstansok definiálása
const sentenceEndMarks = ['.', '!', '?', ':', ';'];
const paragraphThreshold = 12;
const wordSpaceThreshold = 3;
const centerThreshold = 10;
const minMargin = 72;
const indentationThreshold = 20;
const minLineDiff = 5;
const minParagraphLength = 100; // Minimum karakter egy bekezdésben
const shortTextThreshold = 50; // Rövid szöveg küszöbérték

// Új konstansok hozzáadása
const minWordDistance = 0.3; // Minimum távolság két szó között
const maxWordDistance = 2.0; // Maximum távolság két szó között

// Új segédfüggvények
function calculateAverageLineSpacing(items) {
    const lineYPositions = [];
    let lastY = null;
    
    items.forEach(item => {
        const currentY = item.transform[5];
        if (lastY !== null && Math.abs(currentY - lastY) > 1) {
            lineYPositions.push(Math.abs(currentY - lastY));
        }
        lastY = currentY;
    });
    
    if (lineYPositions.length === 0) return 0;
    
    // Kiugró értékek eltávolítása
    const sortedSpacings = lineYPositions.sort((a, b) => a - b);
    const q1Index = Math.floor(sortedSpacings.length * 0.25);
    const q3Index = Math.floor(sortedSpacings.length * 0.75);
    const normalSpacings = sortedSpacings.filter(
        spacing => spacing >= sortedSpacings[q1Index] && 
                  spacing <= sortedSpacings[q3Index]
    );
    
    return normalSpacings.reduce((a, b) => a + b, 0) / normalSpacings.length;
}

// Új segédfüggvények a szavak kezeléséhez
function isPartOfWord(text) {
    return /^[a-záéíóöőúüűA-ZÁÉÍÓÖŐÚÜŰ]/.test(text);
}

function isSeparateWord(currentX, lastX, fontSize) {
    if (!lastX) return true;
    const distance = (currentX - lastX) / fontSize;
    return distance > minWordDistance;
}

// Módosított szóköz-kezelő függvény
function normalizeSpaces(text) {
    // Először normalizáljuk a többszörös szóközöket, de megtartunk minden szóközt
    return text.replace(/[ ]{2,}/g, ' ');
}

// Új segédfüggvény a szóközök ellenőrzésére
function needsSpaceBetween(text1, text2) {
    if (!text1 || !text2) return false;
    const lastChar = text1.slice(-1);
    const firstChar = text2.charAt(0);
    return !(lastChar === ' ' || firstChar === ' ');
}

// Módosított isTextContainsSentenceEnd függvény
function isTextContainsSentenceEnd(text) {
    // Az utolsó nem-szóköz karakter vizsgálata
    const lastNonSpaceChar = text.replace(/\s+$/, '').slice(-1);
    return sentenceEndMarks.includes(lastNonSpaceChar);
}

function isShortText(text) {
    return text.trim().length < shortTextThreshold;
}

// Új szóköz és karakter vizsgáló függvények
function isWordCharacter(char) {
    return /[\p{L}\p{N}]/u.test(char);
}

// Új segédfüggvények a szavak elemzéséhez
function analyzeTextChunk(text) {
    return {
        isWord: /^[a-záéíóöőúüűA-ZÁÉÍÓÖŐÚÜŰ]/.test(text),
        endsWithWord: /[a-záéíóöőúüűA-ZÁÉÍÓÖŐÚÜŰ]$/.test(text),
        startsWithWord: /^[a-záéíóöőúüűA-ZÁÉÍÓÖŐÚÜŰ]/.test(text),
        isPunctuation: /^[.!?:;,)\]}\-]/.test(text),
        isOpenBracket: /^[({[]/.test(text)
    };
}

function calculateWordGap(currentX, lastX, fontSize) {
    return (currentX - lastX) / fontSize;
}

// Új szóköz-kezelő logika
function determineSpacing(prevText, currentText, currentX, lastX, fontSize) {
    if (!prevText || !currentText) return { addSpace: false };
    
    const lastChar = prevText.slice(-1);
    const firstChar = currentText.charAt(0);
    const gap = (currentX - lastX) / fontSize;
    
    const lastType = getCharacterType(lastChar);
    const firstType = getCharacterType(firstChar);
    
    // Ha már van szóköz, ne tegyünk újat
    if (lastType === 'SPACE' || firstType === 'SPACE') return { addSpace: false };
    
    // Nagyon nagy távolság esetén mindig szóköz
    if (gap > SPACE_THRESHOLDS.HUGE_GAP) return { addSpace: true };
    
    // Betű-betű kapcsolat
    if (lastType === 'LETTER' && firstType === 'LETTER') {
        return { addSpace: gap > SPACE_THRESHOLDS.NORMAL_GAP };
    }
    
    // Mondatvég után mindig szóköz, kivéve zárójeleket
    if (lastType === 'SENTENCE_END' && firstType !== 'CLOSE_BRACKET') {
        return { addSpace: true };
    }
    
    // Vessző után szóköz, ha betű vagy szám következik
    if (lastType === 'COMMA' && (firstType === 'LETTER' || firstType === 'NUMBER')) {
        return { addSpace: true };
    }
    
    // Kötőjel speciális kezelése
    if (lastType === 'HYPHEN' || firstType === 'HYPHEN') {
        return { addSpace: false };
    }
    
    // Normál távolság és mindkét oldalon betű vagy szám
    if ((lastType === 'LETTER' || lastType === 'NUMBER') && 
        (firstType === 'LETTER' || firstType === 'NUMBER')) {
        return { addSpace: gap > SPACE_THRESHOLDS.MIN_GAP };
    }
    
    return { addSpace: gap > SPACE_THRESHOLDS.NORMAL_GAP };
}

// Módosított normalizáló függvény
function normalizeText(text) {
    return text
        // Alapvető szóköz normalizálás
        .replace(/\s+/g, ' ')
        // Írásjelek előtti felesleges szóközök eltávolítása
        .replace(/\s+([.!?:;,)\]}])/g, '$1')
        // Írásjelek után szóköz, ha betű vagy szám következik
        .replace(/([.!?:;,)\]}])([a-záéíóöőúüűA-ZÁÉÍÓÖŐÚÜŰ0-9])/g, '$1 $2')
        // Nyitó zárójelek előtti szóköz megtartása
        .replace(/(\S)([({[])/g, '$1 $2')
        .trim();
}

// Új konstansok a szóköz-kezeléshez
const SPACE_THRESHOLDS = {
    MIN_GAP: 0.15,        // Minimum szóköz méret
    NORMAL_GAP: 0.25,     // Normál szóköz méret
    LARGE_GAP: 0.4,       // Nagy szóköz méret
    HUGE_GAP: 0.6         // Biztosan szóköz méret
};

// Új segédfüggvény a karakterek típusának meghatározásához
function getCharacterType(char) {
    if (/[a-záéíóöőúüűA-ZÁÉÍÓÖŐÚÜŰ]/.test(char)) return 'LETTER';
    if (/[0-9]/.test(char)) return 'NUMBER';
    if (/[.!?:;]/.test(char)) return 'SENTENCE_END';
    if (/[,]/.test(char)) return 'COMMA';
    if (/[\-]/.test(char)) return 'HYPHEN';
    if (/[)]/.test(char)) return 'CLOSE_BRACKET';
    if (/[(]/.test(char)) return 'OPEN_BRACKET';
    if (/\s/.test(char)) return 'SPACE';
    return 'OTHER';
}

const pdf = await loadingTask.promise;
let htmlContent = "";
let currentParagraph = "";
let lastX = null;
let lastY = null;
let paragraphStartX = null;
let paragraphEndX = null;
let lastParagraphEndX = null; // Hiányzó változó deklarációja
let lastFontSize = null;
let averageLineSpacing = 0;
let lastLineWidth = 0;
let lastLineWords = 0;

for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const viewport = await page.getViewport({ scale: 1 });
    const pageWidth = page.view[2];
    
    // Előfeldolgozás: átlagos sortávolság számítása
    averageLineSpacing = calculateAverageLineSpacing(textContent.items);
    
    textContent.items.forEach((item, index, array) => {
        const text = item.str;
        const fontSize = item.transform[0];
        const isBold = item.fontName.toLowerCase().includes('bold') || 
                      item.fontName.toLowerCase().includes('black') ||
                      item.fontName.includes('f1') ||
                      item.fontWeight >= 600;
        const isItalic = item.fontName.toLowerCase().includes('italic') || 
                        item.fontName.toLowerCase().includes('oblique');
        const isUnderlined = item.fontName.toLowerCase().includes('underline') ||
                            item.renderingMode === 2;
        const currentX = item.transform[4];
        const currentY = item.transform[5];

        // Először escape-eljük a szöveget
        const safeText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        
        // Utána alkalmazzuk a formázást
        let formattedText = safeText;
        if (isBold && isItalic && isUnderlined) {
            formattedText = `<strong><em><u>${safeText}</u></em></strong>`;
        } else if (isBold && isItalic) {
            formattedText = `<strong><em>${safeText}</em></strong>`;
        } else if (isBold && isUnderlined) {
            formattedText = `<strong><u>${safeText}</u></strong>`;
        } else if (isItalic && isUnderlined) {
            formattedText = `<em><u>${safeText}</u></em>`;
        } else if (isBold) {
            formattedText = `<strong>${safeText}</strong>`;
        } else if (isItalic) {
            formattedText = `<em>${safeText}</em>`;
        } else if (isUnderlined) {
            formattedText = `<u>${safeText}</u>`;
        }
        
        // Bekezdés detektálás finomítása
        const yDiff = lastY !== null ? Math.abs(currentY - lastY) : 0;
        const nextItem = array[index + 1];
        const prevItem = array[index - 1];
        
        // Kombinált bekezdés detektálás
        const isNewParagraph = 
            lastY === null || // Első elem
            yDiff > averageLineSpacing * 1.5 || // Nagyobb sortávolság, mint az átlagos
            (yDiff > averageLineSpacing && ( 
                currentX < paragraphStartX - indentationThreshold || 
                (prevItem && (
                    isTextContainsSentenceEnd(prevItem.str) || 
                    isShortText(prevItem.str) || // Rövid szöveg után új bekezdés
                    currentX < lastX - indentationThreshold
                )) ||
                Math.abs(fontSize - (prevItem ? prevItem.transform[0] : fontSize)) > 1
            )) ||
            (currentParagraph.length > minParagraphLength && 
             yDiff > averageLineSpacing &&
             isTextContainsSentenceEnd(text)) || // Hosszú bekezdés végén mondatvég
            fontSize > lastFontSize + 2 ||
            (isShortText(text) && yDiff > averageLineSpacing * 0.8); // Rövid szöveg külön bekezdésbe

        // Módosított bekezdés normalizálás az if (isNewParagraph) blokkban
        if (isNewParagraph) {
            if (currentParagraph) {
                const normalizedParagraph = normalizeText(currentParagraph);
                
                if (normalizedParagraph.length > 0) {
                    const leftMargin = paragraphStartX;
                    const rightMargin = pageWidth - paragraphEndX;
                    const textWidth = paragraphEndX - paragraphStartX;
                    
                    // Középre igazítás ellenőrzése rövid szövegeknél
                    const isShort = isShortText(currentParagraph);
                    const isCentered = (isShort && Math.abs(leftMargin - rightMargin) < centerThreshold * 2) || 
                                      (!isShort && Math.abs(leftMargin - rightMargin) < centerThreshold && 
                                       leftMargin > minMargin && 
                                       rightMargin > minMargin &&
                                       textWidth < (pageWidth * 0.8));

                    let style = isCentered ? ' style="text-align: center;"' : ' style="text-align: justify;"';
                    if (fontSize > 20) {
                        htmlContent += `<h1${style}>${normalizedParagraph}</h1>`;
                    } else if (fontSize > 16) {
                        htmlContent += `<h2${style}>${normalizedParagraph}</h2>`;
                    } else if (fontSize > 14) {
                        htmlContent += `<h3${style}>${normalizedParagraph}</h3>`;
                    } else if (normalizedParagraph.startsWith("•") || normalizedParagraph.startsWith("-")) {
                        htmlContent += `<li${style}>${normalizedParagraph.substring(1)}</li>`;
                    } else {
                        htmlContent += `<p${style}>${normalizedParagraph}</p>`;
                    }
                }
            }
            lastLineWidth = 0;
            lastLineWords = 0;
            paragraphStartX = currentX;
            currentParagraph = formattedText;
        } else {
            let textToAdd = formattedText;
            const spacing = determineSpacing(
                currentParagraph.slice(-1),
                formattedText,
                currentX,
                lastX,
                fontSize
            );
            
            if (spacing.addSpace) {
                textToAdd = ' ' + textToAdd;
            }
            
            currentParagraph += textToAdd;
            
            // Sor statisztikák frissítése
            if (yDiff > 1) {
                lastLineWidth = lastX - paragraphStartX;
                lastLineWords = currentParagraph.trim().split(/\s+/).length;
            }
        }

        lastX = currentX + item.width;
        lastY = currentY;
        lastFontSize = fontSize;
        paragraphEndX = lastX;
    });
}

// Módosított utolsó bekezdés kiírása
if (currentParagraph) {
    const normalizedParagraph = normalizeText(currentParagraph);
    if (normalizedParagraph.length > 0) {
        htmlContent += `<p>${normalizedParagraph}</p>`;
    }
}

// HTML fájl mentése (csak egyszer)
fs.writeFileSync("sample.html", htmlContent);
