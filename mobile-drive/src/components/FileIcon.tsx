import { Image, StyleSheet, View } from 'react-native';

import { DriveFolder, DriveMedia } from '../driveApi';

const fileThumbnails: Record<string, number> = {
  txt: require('../../thumbnials/txt.png'), docx: require('../../thumbnials/docx.png'), xlsx: require('../../thumbnials/xlsx.png'),
  pptx: require('../../thumbnials/pptx.png'), pdf: require('../../thumbnials/pdf.png'), jpg: require('../../thumbnials/jpg.png'),
  jpeg: require('../../thumbnials/jpg.png'), png: require('../../thumbnials/png.png'), psd: require('../../thumbnials/psd.png'),
  ai: require('../../thumbnials/ai.png'), prproj: require('../../thumbnials/prproj.png'), aep: require('../../thumbnials/aep.png'),
  html: require('../../thumbnials/html.png'), css: require('../../thumbnials/css.png'), js: require('../../thumbnials/js.png'),
  sql: require('../../thumbnials/sql.png'), mp3: require('../../thumbnials/mp3.png'), wav: require('../../thumbnials/wav.png'),
  mp4: require('../../thumbnials/mp4.png'), mov: require('../../thumbnials/mov.png'), zip: require('../../thumbnials/zip.png'),
  rar: require('../../thumbnials/rar.png'), svg: require('../../thumbnials/svg.png'), eps: require('../../thumbnials/eps.png'),
  obj: require('../../thumbnials/obj.png'), gltf: require('../../thumbnials/gltf.png'), webp: require('../../thumbnials/webp.png'),
  csv: require('../../thumbnials/csv.png'), json: require('../../thumbnials/json.png'),
};

const fallbackThumbnail = require('../../thumbnials/txt.png');
const emptyFolderThumbnail = require('../../thumbnials/empty folder.png');
const folderWithFilesThumbnail = require('../../thumbnials/folder with files.png');

export function FileIcon({ item, size = 82, folderHasItems = false }: {
  item: DriveMedia | DriveFolder;
  size?: number;
  folderHasItems?: boolean;
}) {
  const isFolder = !('kind' in item);
  const extension = isFolder ? '' : item.name.split('.').pop()?.toLowerCase() || '';
  const source = isFolder
    ? folderHasItems ? folderWithFilesThumbnail : emptyFolderThumbnail
    : fileThumbnails[extension] || fallbackThumbnail;

  return (
    <View style={[styles.frame, { width: size, height: size }]}>
      <Image source={source} style={styles.image} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
});
