// Branded HTML email shell. Table layout and inline styles only, because
// that's what Gmail, Outlook and phone mail apps render reliably.

const BRAND = "#1DB954";
const INK = "#111827";
const MUTED = "#6b7280";

// Escapes text placed into the HTML body (names and notes are user input)
export const escapeHtml = (value: string) =>
	value.replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			] ?? c,
	);

// Label/value rows (e.g. an amount summary). Both are escaped.
export const detailsTable = (rows: [string, string][]) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid #e5e7eb;border-radius:8px;border-collapse:separate">
  ${rows
		.map(
			([label, value], i) => `
  <tr>
    <td style="padding:12px 16px;font-size:14px;color:${MUTED};${i ? "border-top:1px solid #e5e7eb;" : ""}">${escapeHtml(label)}</td>
    <td align="right" style="padding:12px 16px;font-size:14px;font-weight:bold;color:${INK};${i ? "border-top:1px solid #e5e7eb;" : ""}">${escapeHtml(value)}</td>
  </tr>`,
		)
		.join("")}
</table>`;

// A numbered list of steps (trusted HTML from our own templates)
export const stepsList = (steps: string[]) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px">
  ${steps
		.map(
			(step, i) => `
  <tr>
    <td valign="top" width="32" style="padding:6px 0">
      <div style="width:24px;height:24px;line-height:24px;border-radius:12px;background:${BRAND};color:#ffffff;font-size:12px;font-weight:bold;text-align:center">${i + 1}</div>
    </td>
    <td style="padding:8px 0 6px 8px;font-size:14px;line-height:20px;color:#374151">${step}</td>
  </tr>`,
		)
		.join("")}
</table>`;

export const codeBlock = (code: string) => `
<div style="margin:24px 0;padding:18px;border-radius:8px;background:#f3f4f6;text-align:center;font-size:32px;font-weight:bold;letter-spacing:10px;color:${INK};font-family:'Courier New',monospace">${escapeHtml(code)}</div>`;

export const emailLayout = ({
	preheader,
	heading,
	body,
	cta,
	footnote,
}: {
	// Inbox preview text (hidden in the message itself)
	preheader: string;
	heading: string;
	// Trusted HTML from our own templates; escape user input before passing it
	body: string;
	cta?: { label: string; url: string };
	footnote?: string;
}) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7">
  <tr>
    <td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:Arial,Helvetica,sans-serif">
        <tr>
          <td style="padding:0 4px 16px;font-size:20px;font-weight:bold;color:${INK}">
            <span style="color:${BRAND}">Root Over</span> Education
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;border-radius:12px;border-top:4px solid ${BRAND};padding:32px 28px;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
            <h1 style="margin:0 0 16px;font-size:22px;line-height:30px;color:${INK}">${escapeHtml(heading)}</h1>
            <div style="font-size:15px;line-height:24px;color:#374151">${body}</div>
            ${
							cta
								? `
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px">
              <tr>
                <td style="border-radius:8px;background:${BRAND}">
                  <a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(cta.label)}</a>
                </td>
              </tr>
            </table>
            <p style="margin:12px 0 0;font-size:12px;line-height:18px;color:${MUTED}">Button not working? Open this link:<br><a href="${escapeHtml(cta.url)}" style="color:${BRAND};word-break:break-all">${escapeHtml(cta.url)}</a></p>`
								: ""
						}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 4px 0;font-size:12px;line-height:18px;color:${MUTED}">
            ${footnote ? `${escapeHtml(footnote)}<br><br>` : ""}
            &copy; ${new Date().getFullYear()} Root Over Education. This is an automated message; please don't reply to it.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
