// Pack files: local file and folder utilities (nothing is uploaded). Default category: files.
export const cat = 'files'
export default [
  { id: 'file-inspector', name: 'File inspector', desc: 'Drop any file: name, size, MIME type, dates, hashes, dimensions, metadata.', icon: 'file-search', tags: 'info details properties metadata', ready: true },
  { id: 'file-to-base64', name: 'File to Base64', desc: 'Encode any file as Base64 or a data URI.', icon: 'file-code', also: ['dev'], tags: 'base64 encode file data uri', ready: true },
  { id: 'base64-to-file', name: 'Base64 to file', module: 'file-to-base64', params: { mode: 'decode' }, desc: 'Decode Base64 back into a downloadable file.', icon: 'file-down', also: ['dev'], tags: 'base64 decode', ready: true },
  { id: 'compare-files', name: 'Compare two files', desc: 'Check if two files are identical by hash, and see byte differences.', icon: 'files', tags: 'compare identical hash binary diff', ready: true },
  { id: 'folder-size-analyzer', name: 'Folder size analyzer', desc: 'Pick a folder and see what takes up space, as a tree and chart.', icon: 'folder-tree', tags: 'disk usage folder size', ready: true },
  { id: 'duplicate-files', name: 'Find duplicate files', desc: 'Find identical files in a folder by content hash.', icon: 'copy', tags: 'duplicates same files', ready: true },
  { id: 'bulk-renamer', name: 'Bulk file renamer', desc: 'Rename many files with patterns, numbering and find & replace.', icon: 'pencil-line', tags: 'rename batch bulk pattern', ready: true },
  { id: 'batch-image-renamer', name: 'Batch image renamer', module: 'bulk-renamer', params: { images: true }, cat: 'image', desc: 'Rename photos by date taken, sequence or pattern.', icon: 'images', tags: 'rename photos exif date', ready: true },
  { id: 'extension-changer', name: 'Bulk extension changer', desc: 'Change the extension of many files at once.', icon: 'file-pen-line', tags: 'extension rename', ready: true },
  { id: 'filename-cleaner', name: 'Filename cleaner', desc: 'Remove spaces, accents and odd characters from filenames.', icon: 'brush', tags: 'clean filenames sanitize', ready: true },
  { id: 'local-file-search', name: 'Local file search', desc: 'Pick a folder and search file names and text contents, locally.', icon: 'folder-search', tags: 'search grep folder contents', ready: true },
  { id: 'folder-file-list', name: 'Folder to file list', desc: 'List every file in a folder as CSV, JSON, Markdown or a text tree, with sizes and checksums.', icon: 'list-tree', tags: 'directory listing export csv tree files inventory', ready: true },
  { id: 'hex-viewer', name: 'Hex viewer', desc: 'View any file as hex and ASCII, with offsets and search.', icon: 'binary', also: ['dev'], tags: 'hex dump binary', ready: true },
  { id: 'zip-files', name: 'Create ZIP', desc: 'Compress files and folders into a ZIP archive.', icon: 'file-archive', tags: 'zip compress archive', ready: true },
  { id: 'unzip-files', name: 'Unzip / extract ZIP', desc: 'Open ZIP files, browse contents and extract single files.', icon: 'package-open', tags: 'unzip extract archive', ready: true },
  { id: 'split-file', name: 'Split & join files', desc: 'Cut a big file into parts with a checksum manifest, and join parts back together.', icon: 'split', tags: 'split join parts chunks', ready: true },
  { id: 'join-files', name: 'Join file parts', module: 'split-file', params: { mode: 'join' }, desc: 'Put split parts (.001, .002 ...) back together in order and verify the result.', icon: 'merge', tags: 'join merge combine parts split chunks 001', ready: true },
]
