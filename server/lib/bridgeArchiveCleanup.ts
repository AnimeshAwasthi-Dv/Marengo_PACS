import fs from 'node:fs/promises'
import path from 'node:path'

const uploadFolderPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Removes the folder of a Bridge study ZIP that a re-sent upload replaced. Only a per-upload folder (named by a random
 * UUID) directly under `studiesRoot` is removed, never the folder of the upload that replaced it, so a bad path cannot
 * delete anything else, such as a study's attachments folder.
 */
export async function removeReplacedBridgeArchive(studiesRoot: string, archivePath: string, currentFolder: string) {
  const folder = path.dirname(path.resolve(archivePath))
  if (path.dirname(folder) !== path.resolve(studiesRoot) || !uploadFolderPattern.test(path.basename(folder)) || folder === path.resolve(currentFolder)) return false
  try {
    await fs.rm(folder, { recursive: true, force: true })
    return true
  } catch (error) {
    console.error('Could not remove replaced Bridge study archive', folder, error)
    return false
  }
}
