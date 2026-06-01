import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    collection,
    doc,
    getDoc,
    addDoc,
    deleteDoc,
    updateDoc,
    onSnapshot,
    query,
    getDocs,
    setLogLevel
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global Firebase & State Variables ---
let db, auth, userId;
let firestoreListenerUnsubscribe = null;
let currentPocketItems = [];
let appId = 'default-app-id';
let notificationTimeout;

// --- Storage Keys for UI Preferences ---
const POCKET_SORT_KEY = "pocketSortPreference";
const POCKET_SEARCH_KEY = "pocketSearchTerm";
const POCKET_THEME_KEY = "theme";
const CACHED_ITEMS_KEY = "pocketCachedItems"; 
const CACHED_USER_KEY = "pocketCachedUser";   

// --- DOM Elements ---
const pocketGridContainer = document.getElementById('pocketGridContainer');
const sortControlsContainer = document.querySelector('.sort-controls-container');
const sortOptionsGroup = document.querySelector('.sort-options-group');
const emailListBtn = document.getElementById('emailListBtn');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const addItemForm = document.getElementById('addItemForm');
const addItemInput = document.getElementById('addItemInput');
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
// Mobile Editor Elements
const mobileFab = document.getElementById('mobileFab');
const mobileEditorModal = document.getElementById('mobileEditorModal');
const closeMobileEditorBtn = document.getElementById('closeMobileEditorBtn');
const saveMobileEditorBtn = document.getElementById('saveMobileEditorBtn');
const mobileEditorInput = document.getElementById('mobileEditorInput');
let activeMobileEditId = null;

// Settings Elements
const menuDarkModeToggle = document.getElementById('menuDarkModeToggle');
const menuThemeIcon = document.getElementById('menuThemeIcon');
const menuThemeText = document.getElementById('menuThemeText');
const menuThemeState = document.getElementById('menuThemeState');
const menuDownloadPdfBtn = document.getElementById('menuDownloadPdfBtn');
const menuClearAllBtn = document.getElementById('menuClearAllBtn');
const menuEmailListBtn = document.getElementById('menuEmailListBtn');
const menuInstallAppBtn = document.getElementById('menuInstallAppBtn');

// Unified Modal DOM
const userProfileBtn = document.getElementById('userProfileBtn');
const headerAvatar = document.getElementById('headerAvatar');
const unifiedModalOverlay = document.getElementById('unifiedModalOverlay');
const closeUnifiedModalBtn = document.getElementById('closeUnifiedModalBtn');
const modalAvatar = document.getElementById('modalAvatar');
const modalName = document.getElementById('modalName');
const modalEmail = document.getElementById('modalEmail');
const modalLogoutBtn = document.getElementById('modalLogoutBtn');

const notificationToast = document.getElementById('notificationToast');
const { jsPDF } = window.jspdf;

// Auth-related UI
const loginBtn = document.getElementById('loginBtn');
const mainContentContainer = document.getElementById('mainContentContainer');
const loginPromptMessage = document.getElementById('loginPromptMessage');

// --- Haptic Feedback Helper ---
function triggerHaptic(duration = 10) {
    if ('vibrate' in navigator) {
        navigator.vibrate(duration);
    }
}

// --- Rich Text Toolbar Logic ---
// We use 'mousedown' instead of 'click' so the button doesn't steal focus from the text area.
document.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('.editor-toolbar button');
    if (!btn) return;
    
    // CRITICAL: This prevents the text area from losing focus and clearing your highlight!
    e.preventDefault(); 
    
    const cmd = btn.dataset.cmd;
    const val = btn.dataset.val || null;
    
    // Execute rich text commands on the currently selected text
    document.execCommand(cmd, false, val);
});

// Prevent form submission if a toolbar button is clicked (in case mousedown doesn't catch the click action on some devices)
document.addEventListener('click', (e) => {
    if (e.target.closest('.editor-toolbar button')) {
        e.preventDefault();
    }
});

function showNotification(message, isError = false) {
    if (notificationTimeout) {
        clearTimeout(notificationTimeout);
    }
    notificationToast.textContent = message;
    notificationToast.classList.toggle('error', isError);
    notificationToast.classList.add('show');
    notificationTimeout = setTimeout(() => {
        notificationToast.classList.remove('show');
    }, 3000);
}

// --- Firebase Initialization & Auth Handling ---
async function initFirebase() {
    appId = typeof __app_id !== 'undefined' ? __app_id : 'atikle-v1';

    const firebaseConfig = {
        apiKey: "AIzaSyCFBRUc8afjIrOtet57sltb8M1xrVR5R3c",
        authDomain: "atikle-web.firebaseapp.com",
        projectId: "atikle-web",
        storageBucket: "atikle-web.firebasestorage.app",
        messagingSenderId: "63074656402",
        appId: "1:63074656402:web:0af9a3d0bba7cd7dc0464b",
        measurementId: "G-38WD0DDG8E"
    };

    if (!firebaseConfig.apiKey || !firebaseConfig.authDomain) {
        console.error("Firebase config is missing API key or Auth Domain.");
        loginBtn.style.display = 'none';
        loginPromptMessage.textContent = "This app is not configured for login.";
        loginPromptMessage.style.display = 'block';
        mainContentContainer.style.display = 'none';
        return;
    }

    try {
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        
        // ENABLE FIRESTORE OFFLINE PERSISTENCE
        db = initializeFirestore(app, {
            localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
        });
        
        setLogLevel('Debug');

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
                console.log('User is logged in:', userId);
                localStorage.setItem(CACHED_USER_KEY, "true"); 

                // Update UI
                mainContentContainer.style.display = 'block';
                loginPromptMessage.style.display = 'none';
                loginBtn.style.display = 'none';
                userProfileBtn.style.display = 'block';

                // Fetch User Profile Data for Modal & Avatar
                try {
                    const userDocRef = doc(db, 'artifacts', 'atikle', 'users', userId);
                    const userDocSnap = await getDoc(userDocRef);
                    let displayName = user.displayName || 'User';
                    let photoUrl = user.photoURL || '';

                    if (userDocSnap.exists()) {
                        const userData = userDocSnap.data();
                        if (userData.name) displayName = userData.name;
                        if (userData.photoURL) photoUrl = userData.photoURL;
                    }

                    if (photoUrl && photoUrl.includes('googleusercontent.com')) {
                        if (photoUrl.match(/=s\d+-c/)) {
                            photoUrl = photoUrl.replace(/=s\d+-c/, '=s400-c');
                        } else {
                            photoUrl += '=s400-c';
                        }
                    }

                    if (!photoUrl) {
                        photoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=random`;
                    }

                    headerAvatar.src = photoUrl;
                    modalAvatar.src = photoUrl;
                    modalName.textContent = displayName;
                    modalEmail.textContent = user.email || 'No Email';
                } catch (error) {
                    console.error("Error fetching user profile:", error);
                }

                searchInput.value = localStorage.getItem(POCKET_SEARCH_KEY) || '';
                toggleClearSearchBtn();

                // Setup REAL-TIME Firestore listener
                await setupFirestoreListener(appId, userId);

            } else {
                console.log('User is signed out. Redirecting to atikle Single Sign-On');
                userId = null;
                
                localStorage.removeItem(CACHED_USER_KEY);
                localStorage.removeItem(CACHED_ITEMS_KEY);

                if (firestoreListenerUnsubscribe) {
                    firestoreListenerUnsubscribe();
                    firestoreListenerUnsubscribe = null;
                }

                window.location.href = 'https://atikle.github.io/account/login?app=mypocket';

                mainContentContainer.style.display = 'none';
                loginPromptMessage.style.display = 'block';
                loginBtn.style.display = 'block';
                userProfileBtn.style.display = 'none';
                renderPocketGrid([]);
            }
        });

    } catch (e) {
        console.error("Firebase Init Error:", e);
        showNotification(`Firebase Error: ${e.message}`, true);
    }
}

// --- Unified Modal Logic ---
function openUnifiedModal() {
    unifiedModalOverlay.classList.add('show');
    document.body.classList.add('modal-open'); 
}

function closeUnifiedModal() {
    unifiedModalOverlay.classList.remove('show');
    document.body.classList.remove('modal-open'); 
    resetMenuClearAllBtn(); 
}

userProfileBtn.addEventListener('click', openUnifiedModal);
userProfileBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openUnifiedModal();
    }
});

closeUnifiedModalBtn.addEventListener('click', closeUnifiedModal);
unifiedModalOverlay.addEventListener('click', (e) => {
    if (e.target === unifiedModalOverlay) closeUnifiedModal();
});
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && unifiedModalOverlay.classList.contains('show')) {
        closeUnifiedModal();
        userProfileBtn.focus();
    }
});

modalLogoutBtn.addEventListener('click', () => {
    closeUnifiedModal();
    signOut(auth);
});

// --- Firestore Data Functions ---
async function setupFirestoreListener(appId, uid) {
    if (firestoreListenerUnsubscribe) {
        firestoreListenerUnsubscribe();
    }

    const itemsColRef = collection(db, 'artifacts', appId, 'users', uid, 'mypocket');
    const q = query(itemsColRef);

    firestoreListenerUnsubscribe = onSnapshot(q, { includeMetadataChanges: true }, (querySnapshot) => {
        let items = [];
        querySnapshot.forEach((doc) => {
            items.push({
                id: doc.id,
                ...doc.data()
            });
        });

        currentPocketItems = items;
        localStorage.setItem(CACHED_ITEMS_KEY, JSON.stringify(items));
        renderPocketGrid(items);

    }, (error) => {
        console.error("Error listening to Firestore:", error);
        showNotification("Error: Could not load items.", true);
    });
}

async function addNewPocketItem(htmlContent) {
    if (!htmlContent || htmlContent.trim() === '' || htmlContent === '<br>') return;
    if (!userId) {
        showNotification("You must be logged in to add items.", true);
        return;
    }

    const newItem = {
        text: htmlContent.trim(), // Storing rich HTML content
        dateAdded: new Date().toISOString(),
        wasEdited: false
    };

    try {
        const itemsColRef = collection(db, 'artifacts', appId, 'users', userId, 'mypocket');
        await addDoc(itemsColRef, newItem);

        addItemInput.innerHTML = ''; // Reset rich text area
        localStorage.setItem(POCKET_SORT_KEY, 'latest');
        localStorage.setItem(POCKET_SEARCH_KEY, '');
        searchInput.value = '';
        toggleClearSearchBtn();
        cancelAllEdits();

    } catch (error) {
        console.error("Error adding document: ", error);
        showNotification("Error: Could not save item.", true);
    }
}

async function deletePocketItem(itemId) {
    if (!userId || !itemId) {
        showNotification("Error: Could not delete item.", true);
        return;
    }

    try {
        const itemRef = doc(db, 'artifacts', appId, 'users', userId, 'mypocket', itemId);
        await deleteDoc(itemRef);
    } catch (error) {
        console.error("Error deleting document: ", error);
        showNotification("Error: Could not delete item.", true);
    }
}

async function updatePocketItem(itemId, newText) {
    if (!userId || !itemId) {
        showNotification("Error: Could not update item.", true);
        return;
    }

    if (!newText || newText.trim() === '' || newText === '<br>') {
        deletePocketItem(itemId);
        return;
    }

    const updatedData = {
        text: newText.trim(),
        dateAdded: new Date().toISOString(),
        wasEdited: true
    };

    try {
        const itemRef = doc(db, 'artifacts', appId, 'users', userId, 'mypocket', itemId);
        await updateDoc(itemRef, updatedData);
    } catch (error) {
        console.error("Error updating document: ", error);
        showNotification("Error: Could not update item.", true);
    }
}

// --- Clear All Logic ---
let clearAllTimeout;

function resetMenuClearAllBtn() {
    menuClearAllBtn.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i> Clear All Items';
    menuClearAllBtn.classList.remove('confirm-active');
}

menuClearAllBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!userId) {
        showNotification("You must be logged in to clear items.", true);
        closeUnifiedModal();
        return;
    }

    if (menuClearAllBtn.classList.contains('confirm-active')) {
        menuClearAllBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Clearing...';

        try {
            const itemsColRef = collection(db, 'artifacts', appId, 'users', userId, 'mypocket');
            const q = query(itemsColRef);
            const querySnapshot = await getDocs(q);

            const deletePromises = [];
            querySnapshot.forEach((doc) => {
                deletePromises.push(deleteDoc(doc.ref));
            });

            await Promise.all(deletePromises);
            triggerHaptic(50);

            resetMenuClearAllBtn();
            closeUnifiedModal();
            showNotification("All items have been cleared.", false);

        } catch (error) {
            console.error("Error clearing all items:", error);
            showNotification("Error: Could not clear items.", true);
            resetMenuClearAllBtn();
        }

    } else {
        menuClearAllBtn.classList.add('confirm-active');
        menuClearAllBtn.innerHTML = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Are you sure?';
        cancelAllEdits();

        clearTimeout(clearAllTimeout);
        clearAllTimeout = setTimeout(() => {
            resetMenuClearAllBtn();
        }, 3000);
    }
});

// --- Theme Toggle Logic ---
function applyTheme(theme) {
    const themeColorMeta = document.getElementById('theme-color-meta');

    if (theme === 'dark') {
        document.documentElement.classList.add('dark');
        menuThemeIcon.classList.remove('fa-sun');
        menuThemeIcon.classList.add('fa-moon');
        menuThemeText.textContent = 'Dark Mode';
        menuThemeState.textContent = 'On';

        if (themeColorMeta) themeColorMeta.setAttribute('content', '#000000'); 
    } else {
        document.documentElement.classList.remove('dark');
        menuThemeIcon.classList.remove('fa-moon');
        menuThemeIcon.classList.add('fa-sun');
        menuThemeText.textContent = 'Light Mode';
        menuThemeState.textContent = 'Off';

        if (themeColorMeta) themeColorMeta.setAttribute('content', '#ffffff');
    }
    localStorage.setItem(POCKET_THEME_KEY, theme);
}
menuDarkModeToggle.addEventListener('click', () => {
    let theme = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    applyTheme(theme);
});
menuDarkModeToggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        menuDarkModeToggle.click();
    }
});

// --- Direct Email Items Logic ---
async function emailItemsDirectly() {
    if (!auth || !auth.currentUser || !auth.currentUser.email) {
        showNotification("Error: No email address linked to your account.", true);
        return;
    }

    const items = currentPocketItems;
    if (items.length === 0) {
        showNotification("Your pocket is empty. Add some items first!", true);
        return;
    }

    const email = auth.currentUser.email;
    const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyKVRgkVy0IOu-WdMKNFOwUA-uTd7TqvubWm0rlJPBDoTdby3-8KkBsWsDFiWPan7PHaA/exec';

    if (APPS_SCRIPT_URL.includes('PASTE_YOUR_DEPLOYED_WEB_APP_URL_HERE')) {
        showNotification("Setup incomplete. Please update APPS_SCRIPT_URL in the HTML.", true);
        return;
    }

    const originalText = emailListBtn.querySelector('.btn-text').textContent;
    emailListBtn.querySelector('.btn-text').textContent = 'Sending...';
    emailListBtn.disabled = true;

    try {
        const payloadItems = items.map(item => ({
            text: item.text,
            dateAdded: item.dateAdded,
            wasEdited: item.wasEdited
        }));
        const payload = {
            email: email,
            items: payloadItems
        };

        await fetch(APPS_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify(payload),
            mode: 'no-cors'
        });
        showNotification(`Items successfully sent to ${email}`);
    } catch (error) {
        console.log('Apps Script fetch initiated:', error);
        showNotification(`Items successfully sent to ${email}`);
    } finally {
        emailListBtn.querySelector('.btn-text').textContent = originalText;
        emailListBtn.disabled = false;
    }
}

emailListBtn.addEventListener('click', emailItemsDirectly);

// --- Sort Button Logic ---
sortControlsContainer.addEventListener('click', (e) => {
    const clickedButton = e.target.closest('.sort-btn');
    if (!clickedButton) return;
    if (clickedButton.closest('.sort-actions-group')) return;

    sortOptionsGroup.querySelectorAll('.sort-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
    });
    clickedButton.classList.add('active');
    clickedButton.setAttribute('aria-pressed', 'true');
    const sortValue = clickedButton.dataset.sort;
    localStorage.setItem(POCKET_SORT_KEY, sortValue);
    cancelAllEdits();
    renderPocketGrid(currentPocketItems);
});

function getSortedItems(items) {
    let sortedItems = [...items];
    const sortPreference = localStorage.getItem(POCKET_SORT_KEY) || 'latest';
    if (sortPreference === 'oldest') {
        sortedItems.sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded));
    } else {
        sortedItems.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
    }
    return sortedItems;
}

// --- Download PDF Logic ---
function generateAndDownloadPDF() {
    cancelAllEdits();
    console.log('Generating PDF...');
    try {
        const doc = new jsPDF();
        const allItems = getSortedItems(currentPocketItems);
        const sortPreference = localStorage.getItem(POCKET_SORT_KEY) || 'latest';
        const searchTerm = (localStorage.getItem(POCKET_SEARCH_KEY) || '').toLowerCase();
        
        // Match searching with stripped HTML strings
        const items = searchTerm ? allItems.filter(item => {
            const plainText = item.text.replace(/<[^>]*>/g, '').toLowerCase();
            return plainText.includes(searchTerm);
        }) : allItems;

        const PAGE_MARGIN = 15;
        const PAGE_WIDTH = doc.internal.pageSize.getWidth();
        const PAGE_HEIGHT = doc.internal.pageSize.getHeight();
        const CONTENT_WIDTH = PAGE_WIDTH - (PAGE_MARGIN * 2);
        const BRAND_COLOR = '#ef4056';
        const itemDateOptions = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        };
        const monthYearFormatter = new Intl.DateTimeFormat(undefined, {
            year: 'numeric',
            month: 'long'
        });

        let cursor = 0;
        let currentPage = 1;

        function addPageHeader() {
            doc.setFillColor(BRAND_COLOR);
            doc.rect(0, 0, PAGE_WIDTH, 45, 'F');
            doc.setFontSize(20);
            doc.setFont(undefined, 'bold');
            doc.setTextColor('#FFFFFF');
            doc.text("My Pocket", PAGE_MARGIN, 28);
            try {
                const qr = qrcode(0, 'M');
                qr.addData("https://atikle.github.io/mypocket");
                qr.make();
                const qrDataURL = qr.createDataURL(4, 4);
                doc.addImage(qrDataURL, 'PNG', PAGE_WIDTH - PAGE_MARGIN - 30, (45 - 30) / 2, 30, 30);
            } catch (e) {
                console.error("Failed to generate or add QR code:", e);
            }
            cursor = 60;
        }

        function addPageInfo() {
            doc.setFontSize(10);
            doc.setFont(undefined, 'normal');
            doc.setTextColor('#65676b');
            const genDate = `Generated: ${new Date().toLocaleString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
            let sortInfo = `Sorted: ${sortPreference.charAt(0).toUpperCase() + sortPreference.slice(1)}`;
            doc.text(genDate, PAGE_MARGIN, cursor);
            doc.text(sortInfo, PAGE_WIDTH - PAGE_MARGIN, cursor, { align: 'right' });
            cursor += 6;
            if (searchTerm) {
                doc.text(`Filtered by: "${searchTerm}"`, PAGE_MARGIN, cursor);
                cursor += 6;
            }
            cursor += 10;
        }
        function addPageFooter() {
            doc.setFontSize(9);
            doc.setFont(undefined, 'normal');
            doc.setTextColor('#65676b');
            const link = "atikle.github.io/mypocket";
            doc.text(link, PAGE_MARGIN, PAGE_HEIGHT - 10);
            doc.link(PAGE_MARGIN, PAGE_HEIGHT - 13, doc.getTextWidth(link), 10, { url: 'https://' + link });
            doc.text(`Page ${currentPage}`, PAGE_WIDTH / 2, PAGE_HEIGHT - 10, { align: 'center' });
        }
        function checkPageBreak(requiredHeight) {
            if (cursor + requiredHeight > PAGE_HEIGHT - 25) {
                addPageFooter();
                doc.addPage();
                currentPage++;
                addPageHeader();
                addPageInfo();
                return true;
            }
            return false;
        }
        addPageHeader();
        addPageInfo();
        
        if (items.length === 0) {
            doc.setFontSize(12);
            doc.setTextColor('#65676b');
            doc.text(searchTerm ? `No items match your search for "${searchTerm}".` : "Your pocket is empty.", PAGE_MARGIN, cursor);
        } else {
            const showMonthHeaders = (sortPreference === 'latest' || sortPreference === 'oldest');
            let currentMonthYear = "";
            items.forEach((item) => {
                const itemDateObj = new Date(item.dateAdded);
                let itemDate = itemDateObj.toLocaleDateString(undefined, itemDateOptions) + (item.wasEdited ? " (edited)" : "");
                if (showMonthHeaders) {
                    const monthYear = monthYearFormatter.format(itemDateObj);
                    if (monthYear !== currentMonthYear) {
                        currentMonthYear = monthYear;
                        checkPageBreak(20);
                        doc.setFontSize(16);
                        doc.setFont(undefined, 'bold');
                        doc.setTextColor('#050505');
                        doc.text(monthYear, PAGE_MARGIN, cursor);
                        cursor += 20;
                    }
                }
                
                // Strip HTML tags for clean PDF generation
                let plainText = item.text
                                    .replace(/<br\s*[\/]?>/gi, "\n")
                                    .replace(/<li>/gi, "\n• ")
                                    .replace(/<\/li>/gi, "")
                                    .replace(/<[^>]*>/g, '')
                                    .replace(/&nbsp;/gi, " ");

                const textLines = doc.splitTextToSize(plainText.trim(), CONTENT_WIDTH - 20);
                const textHeight = doc.getTextDimensions(textLines).h;
                const totalCardHeight = textHeight + 10 + 30; // text, date, padding
                checkPageBreak(totalCardHeight + 10);
                doc.setDrawColor('#E0E0E0');
                doc.setFillColor('#FFFFFF');
                doc.roundedRect(PAGE_MARGIN, cursor, CONTENT_WIDTH, totalCardHeight, 3, 3, 'FD');
                let cardCursor = cursor + 15;
                doc.setFontSize(10);
                doc.setFont(undefined, 'normal');
                doc.setTextColor('#050505');
                doc.text(textLines, PAGE_MARGIN + 10, cardCursor);
                cardCursor += textHeight + 10;
                doc.setFontSize(9);
                doc.setTextColor('#65676b');
                doc.text(itemDate, PAGE_MARGIN + 10, cardCursor);
                cursor += totalCardHeight + 10;
            });
        }
        addPageFooter();
        doc.save('my-pocket-items.pdf');
        console.log('PDF generation complete.');

    } catch (e) {
        console.error("Failed to generate PDF:", e);
        showNotification('Failed to generate PDF.', true);
    }
}
downloadPdfBtn.addEventListener('click', generateAndDownloadPDF);
menuDownloadPdfBtn.addEventListener('click', () => {
    generateAndDownloadPDF();
    closeUnifiedModal();
});
menuDownloadPdfBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        generateAndDownloadPDF();
        closeUnifiedModal();
    }
});
if (menuEmailListBtn) {
    menuEmailListBtn.addEventListener('click', () => {
        emailItemsDirectly();
        closeUnifiedModal();
    });

    menuEmailListBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            emailItemsDirectly();
            closeUnifiedModal();
        }
    });
}

// --- Render Logic ---
function renderPocketGrid(items) {
    const isPocketEmpty = items.length === 0;
    const searchTerm = (localStorage.getItem(POCKET_SEARCH_KEY) || '').toLowerCase();
    const sortedItems = getSortedItems(items);
    
    // Filter matching on stripped text so HTML tags don't break searches
    const filteredItems = searchTerm ? sortedItems.filter(item => {
        const plainText = item.text.replace(/<[^>]*>/g, '').toLowerCase();
        return plainText.includes(searchTerm);
    }) : sortedItems;

    pocketGridContainer.innerHTML = '';

    if (isPocketEmpty) {
        pocketGridContainer.innerHTML = '<p class="pocket-empty-message">You have not saved anything yet</p>';
        emailListBtn.disabled = true;
        emailListBtn.setAttribute('aria-disabled', 'true');
        downloadPdfBtn.disabled = true;
        downloadPdfBtn.setAttribute('aria-disabled', 'true');
        menuClearAllBtn.style.opacity = '0.5';
        menuClearAllBtn.style.pointerEvents = 'none';
        return;
    }

    menuClearAllBtn.style.opacity = '1';
    menuClearAllBtn.style.pointerEvents = 'auto';
    downloadPdfBtn.disabled = filteredItems.length === 0;
    downloadPdfBtn.setAttribute('aria-disabled', filteredItems.length === 0);
    emailListBtn.disabled = false;
    emailListBtn.setAttribute('aria-disabled', 'false');

    if (filteredItems.length === 0 && searchTerm) {
        const messageP = document.createElement('p');
        messageP.className = 'pocket-empty-message';
        messageP.textContent = `No items match your search for "`;
        const searchTermSpan = document.createElement('span');
        searchTermSpan.style.fontWeight = '600';
        searchTermSpan.textContent = searchTerm;
        messageP.appendChild(searchTermSpan);
        messageP.appendChild(document.createTextNode(`".`));
        pocketGridContainer.appendChild(messageP);
    }

    const sortButtons = document.querySelectorAll('.sort-options-group .sort-btn');
    const sortPreference = localStorage.getItem(POCKET_SORT_KEY) || 'latest';
    sortButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sort === sortPreference);
        btn.setAttribute('aria-pressed', btn.dataset.sort === sortPreference);
    });

    const itemDateOptions = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    };
    const monthYearFormatter = new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'long'
    });
    let currentMonthYear = "";
    const showMonthHeaders = (sortPreference === 'latest' || sortPreference === 'oldest');

    filteredItems.forEach((item) => {
        let itemDateObj;
        try {
            itemDateObj = new Date(item.dateAdded);
        } catch (e) {
            itemDateObj = new Date();
        }

        if (showMonthHeaders) {
            const monthYear = monthYearFormatter.format(itemDateObj);
            if (monthYear !== currentMonthYear) {
                currentMonthYear = monthYear;
                const monthHeader = document.createElement('h2');
                monthHeader.className = 'month-header';
                monthHeader.textContent = monthYear;
                pocketGridContainer.appendChild(monthHeader);
            }
        }

        const itemEl = document.createElement('div');
        itemEl.className = 'pocket-post-item';
        itemEl.dataset.id = item.id;

        let itemDate = "Date not available";
        try {
            itemDate = itemDateObj.toLocaleDateString(undefined, itemDateOptions);
        } catch (e) {
            console.warn("Could not parse date:", item.dateAdded);
        }

        const wasEdited = item.wasEdited || false;
        const editedIndicator = wasEdited ? '<span class="edited-indicator">(edited)</span>' : '';

        const textDiv = document.createElement('div');
        textDiv.className = 'item-text';
        textDiv.innerHTML = item.text;

        const plainTextForAria = item.text.replace(/<[^>]*>/g, '');
        const truncatedText = plainTextForAria.length > 50 ? plainTextForAria.substring(0, 50) + '...' : plainTextForAria;

        itemEl.innerHTML = `
                    <div class="post-header">
                        <div class="post-header-logo">
                            <i class="fa-solid fa-bookmark" aria-hidden="true"></i>
                        </div>
                        <div class="post-header-date">
                            ${itemDate}${editedIndicator}
                        </div>
                    </div>
                    <div class="post-body">
                        </div>
                    <div class="post-footer">
                        <div class="item-actions">
                            <a href="https://www.google.com/search?q=${encodeURIComponent(plainTextForAria)}" 
                               target="_blank" 
                               class="item-action-btn item-search-btn" 
                               title="Search on Google"
                               aria-label="Search for '${truncatedText}' on Google">
                                <i class="fa-brands fa-google" aria-hidden="true"></i>
                            </a>
                            <button class="item-action-btn item-edit-btn" 
                                    title="Edit"
                                    aria-label="Edit item: '${truncatedText}'">
                                <i class="fas fa-pencil" aria-hidden="true"></i>
                                <i class="fas fa-save" aria-hidden="true"></i>
                            </button>
                            <button class="item-action-btn item-delete-btn" 
                                    title="Delete"
                                    aria-label="Delete item: '${truncatedText}'">
                                <i class="fas fa-trash" aria-hidden="true"></i>
                            </button>
                        </div>
                    </div>
                `;

        itemEl.querySelector('.post-body').prepend(textDiv);
        pocketGridContainer.appendChild(itemEl);
    });
}

// --- Cancel All Edits Logic ---
function cancelAllEdits() {
    document.querySelectorAll('.pocket-post-item.is-editing').forEach(itemEl => {
        itemEl.classList.remove('is-editing');
        itemEl.querySelector('.editor-toolbar')?.remove();
        itemEl.querySelector('.rich-editor')?.remove();

        const deleteButton = itemEl.querySelector('.item-delete-btn');
        const deleteBtnIcon = deleteButton?.querySelector('i');
        if (deleteBtnIcon) {
            deleteBtnIcon.className = 'fas fa-trash';
            deleteButton.title = 'Delete';
        }

        const editButton = itemEl.querySelector('.item-edit-btn');
        if (editButton) {
            const plainTextForAria = itemEl.querySelector('.item-text')?.textContent || 'item';
            const truncatedText = plainTextForAria.substring(0, 50) + '...';
            editButton.title = 'Edit';
            editButton.setAttribute('aria-label', `Edit item: '${truncatedText}'`);
        }
    });
}

// --- Event Delegation ---
pocketGridContainer.addEventListener('click', (e) => {

    const deleteButton = e.target.closest('.item-delete-btn');
    if (deleteButton) {
        const itemEl = deleteButton.closest('.pocket-post-item');
        const itemId = itemEl.dataset.id;

        if (itemEl.classList.contains('is-editing')) {
            cancelAllEdits();
            return;
        }

        itemEl.classList.add('pocket-item-fade-out');
        setTimeout(() => {
            deletePocketItem(itemId);
        }, 300);
        return;
    }

    const editButton = e.target.closest('.item-edit-btn');
    if (editButton) {
        const itemEl = editButton.closest('.pocket-post-item');
        const itemId = itemEl.dataset.id;
        const isEditing = itemEl.classList.contains('is-editing');
        const deleteBtnIcon = itemEl.querySelector('.item-delete-btn i');

        // NEW: Intercept for Mobile!
        if (window.innerWidth <= 640) {
            const currentHTML = itemEl.querySelector('.item-text').innerHTML;
            openMobileEditor(itemId, currentHTML);
            return; // Stop here, do not run the desktop inline-edit logic
        }

        if (isEditing) {
            const editArea = itemEl.querySelector('.rich-editor');
            const newText = editArea.innerHTML;
            updatePocketItem(itemId, newText);
        } else {
            cancelAllEdits();
            const textDiv = itemEl.querySelector('.item-text');
            const currentHTML = textDiv.innerHTML;

            const editToolbar = document.createElement('div');
            editToolbar.className = 'editor-toolbar';
            editToolbar.innerHTML = `
                <button type="button" data-cmd="formatBlock" data-val="<h1>">H1</button>
                <button type="button" data-cmd="formatBlock" data-val="<h2>">H2</button>
                <button type="button" data-cmd="formatBlock" data-val="<h3>">H3</button>
                <button type="button" data-cmd="bold"><i class="fa-solid fa-bold"></i></button>
                <button type="button" data-cmd="italic"><i class="fa-solid fa-italic"></i></button>
                <button type="button" data-cmd="underline"><i class="fa-solid fa-underline"></i></button>
                <button type="button" data-cmd="strikeThrough"><i class="fa-solid fa-strikethrough"></i></button>
                <button type="button" data-cmd="hiliteColor" data-val="#ffff00"><i class="fa-solid fa-highlighter"></i></button>
                <button type="button" data-cmd="insertUnorderedList"><i class="fa-solid fa-list-ul"></i></button>
            `;

            const editTextArea = document.createElement('div');
            editTextArea.className = 'rich-editor';
            editTextArea.contentEditable = "true";
            editTextArea.innerHTML = currentHTML;

            editTextArea.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelAllEdits();
                } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    updatePocketItem(itemId, editTextArea.innerHTML);
                }
            });

            const postBody = itemEl.querySelector('.post-body');
            postBody.appendChild(editToolbar);
            postBody.appendChild(editTextArea);
            itemEl.classList.add('is-editing');

            if (deleteBtnIcon) {
                deleteBtnIcon.className = 'fas fa-xmark';
                itemEl.querySelector('.item-delete-btn').title = 'Cancel';
            }

            editTextArea.focus();
            editButton.title = 'Save';
        }
    }
});

// --- Search Logic ---
function toggleClearSearchBtn() {
    if (searchInput.value.length > 0) {
        clearSearchBtn.style.display = 'flex';
    } else {
        clearSearchBtn.style.display = 'none';
    }
}
searchInput.addEventListener('input', () => {
    localStorage.setItem(POCKET_SEARCH_KEY, searchInput.value);
    toggleClearSearchBtn();
    cancelAllEdits();
    renderPocketGrid(currentPocketItems);
});
clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    localStorage.setItem(POCKET_SEARCH_KEY, '');
    toggleClearSearchBtn();
    cancelAllEdits();
    renderPocketGrid(currentPocketItems);
    searchInput.focus();
});

// --- Real-time Sync Listener ---
window.addEventListener('storage', (e) => {
    if (e.key === POCKET_SORT_KEY) {
        cancelAllEdits();
        renderPocketGrid(currentPocketItems);
    }
    if (e.key === POCKET_SEARCH_KEY) {
        searchInput.value = localStorage.getItem(POCKET_SEARCH_KEY) || '';
        toggleClearSearchBtn();
        cancelAllEdits();
        renderPocketGrid(currentPocketItems);
    }
    if (e.key === POCKET_THEME_KEY) {
        applyTheme(localStorage.getItem(POCKET_THEME_KEY) || 'light');
    }
});

// --- Initial Load & Optimistic UI ---
applyTheme(localStorage.getItem(POCKET_THEME_KEY) || 'light');

// OPTIMISTIC LOAD: If we know they were logged in, show UI immediately
if (localStorage.getItem(CACHED_USER_KEY) === "true") {
    document.getElementById('mainContentContainer').style.display = 'block';
    document.getElementById('loginPromptMessage').style.display = 'none';
    document.getElementById('userProfileBtn').style.display = 'block';
    document.getElementById('loginBtn').style.display = 'none';
    
    try {
        const cachedItems = JSON.parse(localStorage.getItem(CACHED_ITEMS_KEY) || "[]");
        currentPocketItems = cachedItems;
        if (cachedItems.length > 0) {
            renderPocketGrid(cachedItems);
        }
    } catch (e) {
        console.warn("Could not parse cached items", e);
    }
}

addItemForm.addEventListener('submit', (e) => {
    e.preventDefault();
    addNewPocketItem(addItemInput.innerHTML);
});

function openMobileEditor(itemId = null, currentHtml = '') {
    activeMobileEditId = itemId;
    mobileEditorInput.innerHTML = currentHtml;
    mobileEditorModal.classList.add('open');
    document.body.classList.add('modal-open'); // Prevent background scrolling
    
    // Focus the editor after the slide-up animation completes
    setTimeout(() => mobileEditorInput.focus(), 300);
}

function closeMobileEditor() {
    mobileEditorModal.classList.remove('open');
    document.body.classList.remove('modal-open');
    mobileEditorInput.blur();
    activeMobileEditId = null;
    mobileEditorInput.innerHTML = '';
}

// FAB Click -> Open blank modal for a NEW item
mobileFab.addEventListener('click', () => {
    triggerHaptic(15);
    openMobileEditor();
});

// Close button
closeMobileEditorBtn.addEventListener('click', closeMobileEditor);

// Save button -> Decides whether to update or create
saveMobileEditorBtn.addEventListener('click', () => {
    triggerHaptic([10, 30, 10]); // A satisfying double-buzz for saving
    const htmlContent = mobileEditorInput.innerHTML;
    if (activeMobileEditId) {
        updatePocketItem(activeMobileEditId, htmlContent);
    } else {
        addNewPocketItem(htmlContent);
    }
    closeMobileEditor();
});

// --- PWA Install Logic ---
let deferredPrompt;

// Listen for the beforeinstallprompt event to intercept the default browser prompt
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    // Show the "Install App" button in the modal
    if (menuInstallAppBtn) {
        menuInstallAppBtn.style.display = 'flex';
    }
});

if (menuInstallAppBtn) {
    menuInstallAppBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            // Show the install prompt
            deferredPrompt.prompt();
            // Wait for the user to respond to the prompt
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`User response to the install prompt: ${outcome}`);
            // We've used the prompt, and can't use it again, throw it away
            deferredPrompt = null;
            // Hide the button again
            menuInstallAppBtn.style.display = 'none';
            // Close the modal
            closeUnifiedModal();
        }
    });
};

// Boot Firebase in the background
initFirebase();