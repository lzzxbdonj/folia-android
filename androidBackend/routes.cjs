'use strict';

// Folia's NetEase transport routes only; no generic upstream proxy or upload endpoints.
const paths = [
    '/register/anonimous', '/song/detail', '/song/copyright/rcmd', '/logout',
    '/login/qr/key', '/login/qr/create', '/login/qr/check', '/login/status', '/user/account',
    '/like', '/scrobble/v1', '/likelist', '/user/playlist', '/playlist/track/all',
    '/playlist/detail', '/playlist/tracks', '/album', '/album/sublist', '/artist/detail',
    '/artist/album', '/artist/top/song', '/artist/songs', '/song/url/v1', '/lyric/new',
    '/song/chorus', '/cloud/lyric/get', '/user/cloud', '/user/cloud/detail', '/cloudsearch',
    '/personal_fm', '/personal/fm/mode', '/recommend/songs', '/recommend/songs/dislike',
    '/history/recommend/songs', '/history/recommend/songs/detail', '/personalized',
    '/homepage/block/page', '/recommend/resource', '/toplist', '/top/song', '/album/new',
    '/top/playlist', '/simi/song', '/fm_trash', '/playlist/subscribe', '/album/sub',
    '/playlist/detail/dynamic', '/album/detail/dynamic',
];
module.exports = Object.fromEntries(paths.map(route => [route, route.slice(1).replaceAll('/', '_')]));
