/**
 * Google Apps Script endpoint for receiving JSON and sending email.
 * This version avoids CORS issues by using Content-Type: text/plain.
 */

// --- Handle POST requests ---
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    // Parse plain text JSON
    const data = JSON.parse(e.postData.contents);
    const userEmail = data.email;
    const items = data.items;

    if (!userEmail || !items) {
      throw new Error("Missing 'email' or 'items' in POST data.");
    }

    // 1️⃣ Log data to Google Sheet (optional)
    const doc = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = doc.getSheetByName('Sheet1') || doc.insertSheet('Sheet1');
    sheet.appendRow([new Date(), userEmail, items.length, JSON.stringify(items)]);

    // 2️⃣ Build email content
    let itemsHtml = '<ul style="padding-left:20px;font-size:15px;color:#4a5568;line-height:1.6;">';
    if (items.length > 0) {
      items.forEach(item => {
        let itemDate = 'Unknown date';
        try {
          itemDate = new Date(item.dateAdded).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });
        } catch (_) {}

        const text = escapeHTML(item.text).replace(/\n/g, '<br>');
        const edited = item.wasEdited ? ' (edited)' : '';

        itemsHtml += `
          <li style="margin-bottom:15px;">
            <strong style="color:#1a202c;">${text}</strong><br>
            <small style="color:#718096;">Saved on: ${itemDate}${edited}</small>
          </li>`;
      });
    } else {
      itemsHtml += '<li>No items found.</li>';
    }
    itemsHtml += '</ul>';

    const htmlBody = `
      <html>
      <body style="font-family:Inter,Roboto,Arial,sans-serif;background-color:#fff;margin:0;padding:0;">
        <div style="max-width:600px;margin:auto;padding:25px;border:1px solid #e2e8f0;border-radius:8px;">
          <a href="https://atikle.github.io/home" target="_blank">
            <img src="https://atikle.github.io/resource/atikle-logo_multicolor.png" alt="atikle logo" style="width:120px;margin-bottom:20px;">
          </a>
          <h1 style="color:#1a202c;">Your Pocket Items</h1>
          <p style="color:#4a5568;">Here are your ${items.length} saved items from My Pocket:</p>
          ${itemsHtml}
          <p style="color:#4a5568;">Sent by My Pocket team on your request.</p>
        </div>
      </body>
      </html>
    `;

    // 3️⃣ Send email
    MailApp.sendEmail({
      to: userEmail,
      subject: "Your Saved Items from My Pocket",
      htmlBody: htmlBody,
      name: "My Pocket by atikle"
    });

    // 4️⃣ Return success
    return ContentService
      .createTextOutput(JSON.stringify({ result: 'success', email: userEmail }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    console.error(err);
    return ContentService
      .createTextOutput(JSON.stringify({ result: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// --- Utility: Escape HTML to prevent XSS ---
function escapeHTML(str) {
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}
