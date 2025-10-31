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

    // 2️⃣ Build email content (This part remains the same)
    let itemsHtml = '<ul style="padding:0; margin:0; list-style-type: none;">'; // MOD: Removed padding and list-style
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

        // MOD: Moved date to the top and improved item styling
        itemsHtml += `
          <li style="margin-bottom:18px; padding-bottom: 18px; border-bottom: 1px solid #e8e8e8; list-style-type: none;">
            <p style="margin:0 0 8px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; color:#65676b;">
              <strong>Saved on:</strong> ${itemDate}${edited}
            </p>
            <p style="margin:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 16px; color:#050505; line-height: 1.6;">
              ${text}
            </p>
          </li>`;
      });
    } else {
      itemsHtml += '<li style="list-style-type: none; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif; color:#4a5568;">No items found.</li>';
    }
    itemsHtml += '</ul>';

    // MOD: Replaced entire htmlBody with the template from your other project,
    // but swapped content and kept the desired footer.
    const htmlBody = `
      <!DOCTYPE html>
      <html>
      <body style="margin: 0; padding: 0px; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center">
              <table width="600" border="0" cellspacing="0" cellpadding="0" style="width: 100%; max-width: 600px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #e2e8f0;">
                
                <!-- Header -->
                <tr>
                  <td align="left" style="padding: 30px 25px;">
                      <a href="https://atikle.github.io/home" target="_blank">
                         <img src="https://atikle.github.io/resource/atikle-logo_multicolor.png" alt="atikle logo" style="width: 20%; min-width: 100px; height: auto; border: 0;">
                      </a>
                  </td>
                </tr>
                
                <!-- Title -->
                <tr><td align="center" style="padding: 15px 30px 15px 30px;"><h1 style="font-size: 26px; font-weight: 600; color: #1a202c; margin: 0;">Your My Pocket Items</h1></td></tr>
                
                <!-- HR -->
                <tr><td style="padding: 0 30px;"><hr style="border: 0; border-top: 1px solid #e2e8f0;"></td></tr>
                
                <!-- Body -->
                <tr>
                  <td style="padding: 25px 30px 20px 30px;">
                    <p style="font-size: 16px; color: #4a5568; line-height: 1.6;">
                      Here are the ${items.length} saved items from your My Pocket account:
                    </p>
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-top: 20px;">
                      <tr>
                        <td>
                          ${itemsHtml} <!-- This is the <ul>...</ul> block -->
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <!-- Footer (Kept from your original My Pocket template, but styled to match) -->
                <tr>
                  <td align="left" style="padding: 20px 30px; background-color: #f9f9f9; border-top: 1px solid #e2e8f0; border-bottom-left-radius: 8px; border-bottom-right-radius: 8px;">
                    <p style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; color: #65676b; line-height: 1.6; margin: 0;">
                      This email was sent to you because you requested a copy of your My Pocket items to this email address. 
                      If you did not request this, you can safely ignore this email.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
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

