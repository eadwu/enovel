const path = require('path')
const HTTP = require('./http')

const Constants = require('./constants')
const FileSystem = require('./fs')
const Parser = require('./parse')
const Pandoc = require('./pandoc')
const Tidy = require('./tidy')

const { HOST, PATH } = Constants

/**
 * A recursive loop that runs 'n-i' times
 * @async
 * @param {number} n - Number of times to run "loop"
 * @param {function(i: number): Promise<any>} func - Function that returns a promise with the current index as its
 * parameter
 * @param {number=} i 0 - Starting index, defaults to 0
 * @return {Promise<undefined>} Default `Promise` returned from an `async` function
 */
async function pRecurse (n, func, i = 0) {
  if (n - i <= 0) return
  await func(i)
  await pRecurse(n, func, ++i)
}

/**
 * Gets and creates a metadata file for the EPUB
 * @async
 * @param {string} cwd - The intended destination working directory
 * @param {Object<string, any>} param2 - Options
 * @param {number} param2.source - Integer from `SOURCE` that represents the novel's hosting site
 * @param {string} param2.novel - The novel name for the path in the URL
 * @return {Promise<undefined>} Default `Promise` returned from an `async` function
 */
async function getMetadata (cwd, { novel, source }) {
  const blob = await HTTP.REQUEST(`${HOST[source]}${PATH[source]}${novel}`, 'GET')
  const metadata = Parser.retrieveMetadata(blob, { source })
  const imageSource = await HTTP.REQUEST(metadata.cover, 'GET', null)

  FileSystem.create(path.resolve(cwd, 'cover.jpg')).write(Buffer.concat(imageSource))
  FileSystem.create(path.resolve(cwd, 'metadata.xml'))
    .write('<dc:language>en-US</dc:language>\n')
    .write(`<dc:title opf-type="main">${metadata.title}</dc:title>\n`)
    .write('<!-- <dc:title opf-type="subtitle">Book N</dc:title> -->\n')
    .write('<!-- <dc:creator opf-role="aut">Author</dc:creator> -->\n')
    .write(`<dc:creator opf-role="trl">${metadata.translator}</dc:creator>\n`)
    .write('<!-- <dc:creator opf-role="edt">Editor</dc:creator> -->\n')
    .write('<dc:date>2018</dc:date>\n')
    .write('<dc:rights>Copyright ©2018</dc:rights>')
}

class Downloader {
  /**
   * Downloads the necessary HTML for the chapters
   * @param {number} start - The starting chapter to download
   * @param {number} end - The ending chapter to stop download
   * @param {Object<string, any>} param2 - Options
   * @param {number} param2.source - Integer from `SOURCE` that represents the novel's hosting site
   * @param {string} param2.novel - The novel name for the path in the URL
   * @param {string} param2.abbreviation - The abbreviation of the novel name
   * @return {string | undefined} Returns `Invalid query` when the ending chapter is before the starting chapter
   */
  static download (start, end, { source, novel, abbreviation }) {
    if (end < start) return 'Invalid query'
    const delta = end - start + 1 // offset +1
    const cwd = path.resolve(__dirname, '..', 'out', abbreviation.toUpperCase())

    FileSystem.create(path.resolve(cwd, 'raw.html'))
    pRecurse(delta, i => {
      const currentChapter = start + i

      return new Promise((resolve, reject) => {
        HTTP.REQUEST(`${HOST[source]}${PATH[source]}${novel}/${abbreviation}-chapter-${currentChapter}`, 'GET')
          .then(blob => {
            if (typeof blob === 'number') resolve(0) // Force exit success for 404
            const targetContent = Parser.parse(blob, { source })

            if (!targetContent) reject(new Error(`Failed parse for chapter ${currentChapter}`))
            FileSystem.write(targetContent)
            resolve(0)
          })
          .catch(err => {
            reject(err)
          })
      })
    }).then(async () => {
      const sourceFile = FileSystem.file.path

      await getMetadata(cwd, { novel, source })
      await Tidy.stream(sourceFile, path.resolve(cwd, 'converted.xhtml'))
      await Pandoc.stream(FileSystem.file.path, path.resolve(cwd, `${novel}.epub`))
    })
  }
}

module.exports = Downloader