// Starter documents. Each template is plain HTML that goes through the same schema parser as pasted or imported content.
export const TEMPLATES = [
  { id: 'blank', name: 'Blank', icon: 'file', title: 'Untitled document', html: '<p></p>' },
  {
    id: 'resume', name: 'Resume', icon: 'briefcase', title: 'Resume',
    settings: { margins: { top: 18, right: 20, bottom: 18, left: 20 } },
    html: `<p data-variant="title">Your Name</p>
<p data-variant="subtitle">Product designer · you@example.com · +1 555 0100 · City, Country</p>
<h2>Summary</h2>
<p>Designer with 6 years of experience shipping web and mobile products. Strong at turning messy problems into simple, testable flows.</p>
<h2>Experience</h2>
<h3>Senior Product Designer, Northwind</h3>
<p><em>2022 - present</em></p>
<ul><li>Led the redesign of onboarding, lifting activation from 41% to 58%.</li><li>Built a shared component library used by 4 product teams.</li><li>Mentored two junior designers.</li></ul>
<h3>Product Designer, Contoso</h3>
<p><em>2019 - 2022</em></p>
<ul><li>Designed the first mobile app, reaching 200k downloads in 6 months.</li><li>Ran weekly user tests and turned findings into a prioritised backlog.</li></ul>
<h2>Education</h2>
<p><strong>BDes, Industrial Design</strong>, State University, 2018</p>
<h2>Skills</h2>
<p>Figma, prototyping, user research, design systems, HTML and CSS, workshop facilitation</p>`,
  },
  {
    id: 'letter', name: 'Letter', icon: 'mail', title: 'Letter',
    html: `<p style="text-align:right">Your Name<br>12 Example Street<br>City, 000000</p>
<p style="text-align:right">1 January 2027</p>
<p>Recipient Name<br>Company Name<br>34 Sample Road<br>City, 000000</p>
<p><strong>Subject: Short, specific subject line</strong></p>
<p>Dear Recipient,</p>
<p>Open with the reason you are writing in one or two sentences. Say what you want or what you are offering, then give the details that make it easy to say yes.</p>
<p>Keep paragraphs short. Use a list when you have several points:</p>
<ul><li>First point, with the key number or date</li><li>Second point</li><li>Third point</li></ul>
<p>Close with the next step and when you will follow up. Thank the reader for their time.</p>
<p>Sincerely,</p>
<p><br></p>
<p>Your Name</p>`,
  },
  {
    id: 'meeting', name: 'Meeting notes', icon: 'clipboard-list', title: 'Meeting notes',
    html: `<p data-variant="title">Meeting notes</p>
<p data-variant="subtitle">Project sync · date · attendees</p>
<h2>Agenda</h2>
<ol><li>Status since last meeting</li><li>Blockers and risks</li><li>Decisions needed</li></ol>
<h2>Notes</h2>
<p>Write what was discussed. Keep it to facts and decisions.</p>
<h2>Decisions</h2>
<ul><li>Decision one, and who made it</li></ul>
<h2>Action items</h2>
<ul data-task><li data-task data-checked="false"><p>Owner - action - due date</p></li><li data-task data-checked="false"><p>Owner - action - due date</p></li></ul>`,
  },
  {
    id: 'report', name: 'Report', icon: 'scroll-text', title: 'Report',
    html: `<p data-variant="title">Report title</p>
<p data-variant="subtitle">Prepared by Your Name · date</p>
<h1>1. Summary</h1>
<p>State the conclusion first: what you found and what you recommend. A reader who stops here should still get the point.</p>
<h1>2. Background</h1>
<p>Explain the situation and why it matters. Link to source material where it helps.</p>
<h1>3. Findings</h1>
<h2>3.1 Key numbers</h2>
<table><tbody><tr><th><p>Metric</p></th><th><p>Last quarter</p></th><th><p>This quarter</p></th></tr><tr><td><p>Active users</p></td><td><p>12,400</p></td><td><p>14,950</p></td></tr><tr><td><p>Retention</p></td><td><p>61%</p></td><td><p>64%</p></td></tr></tbody></table>
<h2>3.2 Observations</h2>
<p>Describe what the numbers mean in plain words.</p>
<h1>4. Recommendations</h1>
<ol><li>Do the most important thing first.</li><li>Then the next one.</li></ol>`,
  },
  {
    id: 'checklist', name: 'Checklist', icon: 'list-checks', title: 'Checklist',
    html: `<p data-variant="title">Weekly checklist</p>
<ul data-task><li data-task data-checked="true"><p>Plan the week</p></li><li data-task data-checked="false"><p>Review open tasks</p></li><li data-task data-checked="false"><p>Reply to important messages</p></li><li data-task data-checked="false"><p>Finish the main project milestone</p></li></ul>`,
  },
]

export const WELCOME = {
  id: 'welcome', name: 'Welcome', icon: 'sparkles', title: 'Welcome to Docs',
  html: `<p data-variant="title">Welcome to Docs</p>
<p data-variant="subtitle">A private word processor that runs in your browser</p>
<p>Everything you type is saved automatically on <strong>this device</strong>. Nothing is uploaded. Open a Word file, write, then download it as <strong>DOCX</strong>, <strong>PDF</strong>, <strong>Markdown</strong> or <strong>HTML</strong>.</p>
<h2>Try it</h2>
<ul data-task>
<li data-task data-checked="true"><p>Start typing in this page</p></li>
<li data-task data-checked="false"><p>Select a word and make it <strong>bold</strong>, <em>italic</em>, <mark style="background-color:#fff176">highlighted</mark> or <span style="color:#d92d20">red</span> from the toolbar</p></li>
<li data-task data-checked="false"><p>Press Ctrl+F to find and replace text</p></li>
<li data-task data-checked="false"><p>Insert a table, then press Tab in the last cell to add a row</p></li>
<li data-task data-checked="false"><p>Paste or drop an image, then drag a corner to resize it</p></li>
</ul>
<h2>Markdown shortcuts</h2>
<p>Type <code>#</code> and a space for a heading, <code>-</code> and a space for a bullet list, <code>1.</code> for a numbered list, <code>[ ]</code> for a checklist, and <code>**bold**</code> for bold.</p>
<h2>Pages</h2>
<p>The page view shows A4 or Letter paper with real margins. Change the paper, margins and page numbers in the <em>Page</em> panel. Press Ctrl+Enter for a page break.</p>
<blockquote><p>Tip: the Documents panel on the left keeps all your documents. Use it to start from a template such as a resume or meeting notes.</p></blockquote>`,
}

export const templateById = (id) => [WELCOME, ...TEMPLATES].find((t) => t.id === id) || TEMPLATES[0]
