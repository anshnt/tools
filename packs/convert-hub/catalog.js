// Pack convert-hub: the universal File Converter, which runs every conversion on this device. Default category: files.
export const cat = 'files'
export default [
  { id: 'file-converter', name: 'File Converter', desc: 'Drop any files, pick a format, convert them all at once. Pictures, PDF, documents, video and more, privately on your device.', icon: 'arrow-left-right', also: ['pdf', 'image', 'media', 'text', 'data'], tags: 'convert converter any file format change batch pdf image video audio document spreadsheet universal', ready: true },
  { id: 'batch-file-converter', name: 'Batch file converter', module: 'file-converter', params: { view: 'batch' }, desc: 'Convert whole folders of mixed files in one go, with presets, naming patterns and a ZIP of the results.', icon: 'files', also: ['pdf', 'image', 'media'], tags: 'batch bulk many folder convert multiple files mixed zip presets', ready: true },
  { id: 'watch-folder-converter', name: 'Watch folder converter', module: 'file-converter', params: { view: 'watch' }, desc: 'Pick a folder and every new file that lands in it is converted automatically while this page is open.', icon: 'folder-sync', tags: 'watch folder automatic auto convert hot folder new files', ready: true },
  { id: 'conversion-history', name: 'Recent conversions', module: 'file-converter', params: { view: 'history' }, desc: 'Your last 30 converted files, kept on this device so you can download or convert them again.', icon: 'history', tags: 'history recent converted files again download', ready: true },
]
