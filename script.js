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
const POCKET_VIEW_KEY = "pocketViewMode";
const CACHED_ITEMS_KEY = "pocketCachedItems"; 
const CACHED_USER_KEY = "pocketCachedUser";   

// --- DOM Elements ---
const pocketGridContainer = document.getElementById('pocketGridContainer');
const sortControlsContainer = document.querySelector('.sort-controls-container');
const sortOptionsGroup = document.querySelector('.sort-options-group');
const viewToggleBtn = document.getElementById('viewToggleBtn');
const emailListBtn = document.getElementById('emailListBtn');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');

// Universal Editor Elements
const mainFab = document.getElementById('mainFab');
const editorModal = document.getElementById('editorModal');
const editorModalOverlay = document.getElementById('editorModalOverlay');
const closeEditorBtn = document.getElementById('closeEditorBtn');
const saveEditorBtn = document.getElementById('saveEditorBtn');
const editorInput = document.getElementById('editorInput');
let activeEditId = null;

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
document.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('.editor-toolbar button');
    if (!btn) return;
    
    e.preventDefault(); 
    
    const cmd = btn.dataset.cmd;
    const val = btn.dataset.val || null;
    
    document.execCommand(cmd, false, val);
});

document.addEventListener('click', (e) => {
    if (e.target.closest('.editor-toolbar button')) {
        e.preventDefault();
    }
});

// --- Rich Text Paste Sanitizer ---
function sanitizePastedContent(e) {
    e.preventDefault();
    
    const clipboardData = e.clipboardData || window.clipboardData;
    const pastedHtml = clipboardData.getData('text/html');
    const pastedText = clipboardData.getData('text/plain');

    if (pastedHtml) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(pastedHtml, 'text/html');
        
        const elements = doc.body.querySelectorAll('*');
        elements.forEach(el => {
            el.removeAttribute('style');
            el.removeAttribute('class');
            el.removeAttribute('id');
            el.removeAttribute('data-darkreader-inline-color'); 
            el.removeAttribute('data-darkreader-inline-bgcolor');
            
            if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') {
                el.remove();
            }
        });
        
        document.execCommand('insertHTML', false, doc.body.innerHTML);
    } else {
        document.execCommand('insertText', false, pastedText);
    }
}

editorInput.addEventListener('paste', sanitizePastedContent);

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
        
        db = initializeFirestore(app, {
            localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
        });
        
        setLogLevel('Debug');

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
                console.log('User is logged in:', userId);
                localStorage.setItem(CACHED_USER_KEY, "true"); 

                mainContentContainer.style.display = 'block';
                loginPromptMessage.style.display = 'none';
                loginBtn.style.display = 'none';
                userProfileBtn.style.display = 'block';

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
    // Add a state to the browser history
    history.pushState({ modalOpen: 'unified' }, '');
}

function closeUnifiedModal(fromPopState) {
    unifiedModalOverlay.classList.remove('show');
    document.body.classList.remove('modal-open'); 
    resetMenuClearAllBtn(); 
    
    // If closed via UI (not back button), pop the state to keep history clean
    if (fromPopState !== true && history.state && history.state.modalOpen === 'unified') {
        history.back();
    }
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
        text: htmlContent.trim(), 
        dateAdded: new Date().toISOString(),
        wasEdited: false
    };

    try {
        const itemsColRef = collection(db, 'artifacts', appId, 'users', userId, 'mypocket');
        await addDoc(itemsColRef, newItem);

        localStorage.setItem(POCKET_SORT_KEY, 'latest');
        localStorage.setItem(POCKET_SEARCH_KEY, '');
        searchInput.value = '';
        toggleClearSearchBtn();
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

// --- View Toggle Logic (Grid / List) ---
function applyViewMode(mode) {
    if (mode === 'grid') {
        pocketGridContainer.classList.add('grid-view');
        if (viewToggleBtn) {
            viewToggleBtn.innerHTML = '<i class="fa-solid fa-list"></i>';
            viewToggleBtn.title = 'Switch to List View';
            viewToggleBtn.setAttribute('aria-label', 'Switch to List View');
        }
    } else {
        pocketGridContainer.classList.remove('grid-view');
        if (viewToggleBtn) {
            viewToggleBtn.innerHTML = '<i class="fa-solid fa-table-cells-large"></i>';
            viewToggleBtn.title = 'Switch to Grid View';
            viewToggleBtn.setAttribute('aria-label', 'Switch to Grid View');
        }
    }
    localStorage.setItem(POCKET_VIEW_KEY, mode);
}

if (viewToggleBtn) {
    viewToggleBtn.addEventListener('click', () => {
        const isCurrentlyGrid = pocketGridContainer.classList.contains('grid-view');
        applyViewMode(isCurrentlyGrid ? 'list' : 'grid');
        triggerHaptic(10);
    });
}

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
    if (clickedButton.closest('.sort-actions-group') || clickedButton.id === 'viewToggleBtn') return;

    sortOptionsGroup.querySelectorAll('.sort-btn:not(#viewToggleBtn)').forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
    });
    clickedButton.classList.add('active');
    clickedButton.setAttribute('aria-pressed', 'true');
    const sortValue = clickedButton.dataset.sort;
    localStorage.setItem(POCKET_SORT_KEY, sortValue);
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
    console.log('Generating PDF...');
    try {
        const doc = new jsPDF();
        const allItems = getSortedItems(currentPocketItems);
        const sortPreference = localStorage.getItem(POCKET_SORT_KEY) || 'latest';
        const searchTerm = (localStorage.getItem(POCKET_SEARCH_KEY) || '').toLowerCase();
        
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
                
                let plainText = item.text
                                    .replace(/<br\s*[\/]?>/gi, "\n")
                                    .replace(/<li>/gi, "\n• ")
                                    .replace(/<\/li>/gi, "")
                                    .replace(/<[^>]*>/g, '')
                                    .replace(/&nbsp;/gi, " ");

                const textLines = doc.splitTextToSize(plainText.trim(), CONTENT_WIDTH - 20);
                const textHeight = doc.getTextDimensions(textLines).h;
                const totalCardHeight = textHeight + 10 + 30; 
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

    const sortButtons = document.querySelectorAll('.sort-options-group .sort-btn:not(#viewToggleBtn)');
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


// --- Event Delegation ---
pocketGridContainer.addEventListener('click', (e) => {
    const deleteButton = e.target.closest('.item-delete-btn');
    if (deleteButton) {
        const itemEl = deleteButton.closest('.pocket-post-item');
        const itemId = itemEl.dataset.id;

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
        const currentHTML = itemEl.querySelector('.item-text').innerHTML;
        
        openEditor(itemId, currentHTML);
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
    renderPocketGrid(currentPocketItems);
});
clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    localStorage.setItem(POCKET_SEARCH_KEY, '');
    toggleClearSearchBtn();
    renderPocketGrid(currentPocketItems);
    searchInput.focus();
});

// --- Real-time Sync Listener ---
window.addEventListener('storage', (e) => {
    if (e.key === POCKET_SORT_KEY) {
        renderPocketGrid(currentPocketItems);
    }
    if (e.key === POCKET_SEARCH_KEY) {
        searchInput.value = localStorage.getItem(POCKET_SEARCH_KEY) || '';
        toggleClearSearchBtn();
        renderPocketGrid(currentPocketItems);
    }
    if (e.key === POCKET_THEME_KEY) {
        applyTheme(localStorage.getItem(POCKET_THEME_KEY) || 'light');
    }
    if (e.key === POCKET_VIEW_KEY) {
        applyViewMode(localStorage.getItem(POCKET_VIEW_KEY) || 'list');
    }
});

// --- Initial Load & Optimistic UI ---
applyTheme(localStorage.getItem(POCKET_THEME_KEY) || 'light');
applyViewMode(localStorage.getItem(POCKET_VIEW_KEY) || 'list');

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

// --- Universal Editor Logic ---
function openEditor(itemId = null, currentHtml = '') {
    activeEditId = itemId;
    editorInput.innerHTML = currentHtml;
    editorModal.classList.add('open');
    editorModalOverlay.classList.add('show');
    document.body.classList.add('modal-open'); 
    // Add a state to the browser history
    history.pushState({ modalOpen: 'editor' }, '');
    
    setTimeout(() => editorInput.focus(), 300);
}

function closeEditor(fromPopState) {
    editorModal.classList.remove('open');
    editorModalOverlay.classList.remove('show');
    document.body.classList.remove('modal-open');
    editorInput.blur();
    activeEditId = null;
    editorInput.innerHTML = '';
    
    // If closed via UI (not back button), pop the state to keep history clean
    if (fromPopState !== true && history.state && history.state.modalOpen === 'editor') {
        history.back();
    }
}

mainFab.addEventListener('click', () => {
    triggerHaptic(15);
    openEditor();
});

closeEditorBtn.addEventListener('click', closeEditor);
editorModalOverlay.addEventListener('click', closeEditor);

// Save with shortcut keys
editorInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        saveEditorBtn.click();
    } else if (event.key === 'Escape') {
        event.preventDefault();
        closeEditor();
    }
});

saveEditorBtn.addEventListener('click', () => {
    triggerHaptic([10, 30, 10]); 
    const htmlContent = editorInput.innerHTML;
    if (activeEditId) {
        updatePocketItem(activeEditId, htmlContent);
    } else {
        addNewPocketItem(htmlContent);
    }
    closeEditor();
});

// --- PWA Install Logic ---
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (menuInstallAppBtn) {
        menuInstallAppBtn.style.display = 'flex';
    }
});

// --- Handle Hardware Back Button & Swipes ---
window.addEventListener('popstate', (e) => {
    // If a user triggers the back gesture and a modal is open, intercept it and close the modal
    if (unifiedModalOverlay.classList.contains('show')) {
        closeUnifiedModal(true); // Pass true so it doesn't trigger another history.back()
    }
    if (editorModal.classList.contains('open')) {
        closeEditor(true);
    }
});

if (menuInstallAppBtn) {
    menuInstallAppBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`User response to the install prompt: ${outcome}`);
            deferredPrompt = null;
            menuInstallAppBtn.style.display = 'none';
            closeUnifiedModal();
        }
    });
};

initFirebase();