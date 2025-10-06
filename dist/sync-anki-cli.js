#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit';
const __dirname = process.cwd();
// import your helpers
import { getBlobNameFromUrl, invokeAnkiConnect, createIPAFieldValue } from './helpers.js';
// CLI entry
async function main() {
    let args = process.argv.slice(2);
    if (!args[0]) {
        console.error('Usage: node sync-anki-cli.js <path-to-json>');
        process.exit(1);
    }
    let jsonPath = path.resolve(process.cwd(), args[0]);
    if (!fs.existsSync(jsonPath)) {
        console.error(`File not found: ${jsonPath}`);
        process.exit(1);
    }
    let userData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const deckName = `Vocab Builder`;
    const modelName = 'Custom: Vocab Builder';
    // check AnkiConnect
    try {
        await invokeAnkiConnect('version');
    }
    catch (err) {
        console.error('AnkiConnect not running or not installed');
        process.exit(1);
    }
    // setup deck
    try {
        let decks = await invokeAnkiConnect('deckNames');
        if (!decks.includes(deckName)) {
            await invokeAnkiConnect('createDeck', { deck: deckName });
            await invokeAnkiConnect('createModel', {
                modelName,
                inOrderFields: ['Sentence', 'Audio', 'IPA', 'Translation', 'Note', 'dbID'],
                css: fs.readFileSync(path.join(__dirname, 'card.css'), 'utf-8'), // optional external CSS
                isCloze: false,
                cardTemplates: [
                    {
                        Name: 'Basic',
                        Front: '<p class="sentence">{{Sentence}}</p><ul class="ipa">{{IPA}}</ul><div class="audio">{{Audio}}</div>',
                        Back: '{{FrontSide}}<hr id="answer"><p class="translation">{{Translation}}</p><p class="note">{{Note}}</p>',
                    },
                    {
                        Name: 'Reverse',
                        Front: '<p class="translation">{{Translation}}</p>',
                        Back: '{{FrontSide}}<hr id="answer"><p class="sentence">{{Sentence}}</p><ul class="ipa">{{IPA}}</ul><p class="note">{{Note}}</p><div class="audio">{{Audio}}</div>',
                    },
                    {
                        Name: 'Type',
                        Front: '<div class="input">{{type:Sentence}}</div><p class="translation">{{Translation}}</p><div class="audio">{{Audio}}</div>',
                        Back: '{{FrontSide}}<hr id="answer"><ul class="ipa">{{IPA}}</ul><p class="note">{{Note}}</p>',
                    },
                ],
            });
            let fontPath = path.join(process.cwd(), 'public', 'fonts', 'Roboto.woff2');
            if (fs.existsSync(fontPath)) {
                await invokeAnkiConnect('storeMediaFile', { filename: '_Roboto.woff2', path: fontPath });
            }
        }
    }
    catch (err) {
        console.error('Failed to setup deck:', err);
        process.exit(1);
    }
    // fetch existing notes
    let existingNotes = [];
    try {
        existingNotes = await invokeAnkiConnect('notesInfo', { query: `deck:"${deckName}"` });
    }
    catch (err) {
        console.error('Failed to fetch existing notes:', err);
        process.exit(1);
    }
    let existingNotesMap = new Map();
    for (let note of existingNotes) {
        if (note.fields.dbID?.value)
            existingNotesMap.set(note.fields.dbID.value, note);
    }
    // prepare add/update/delete
    let toAdd = [];
    let toUpdate = [];
    let toDelete = [];
    for (let item of userData) {
        let note = existingNotesMap.get(item.id);
        let IPAFieldValue = createIPAFieldValue(item.pieces);
        let sentenceNote = item.note ?? '';
        if (!note) {
            let audioFileName = getBlobNameFromUrl(item.audioUrl);
            let noteParam = {
                deckName,
                modelName,
                fields: {
                    Sentence: item.sentence,
                    Translation: item.translation,
                    Note: sentenceNote,
                    dbID: item.id,
                    IPA: IPAFieldValue,
                    Audio: '',
                },
                ...(audioFileName.endsWith('.mp3') && { audio: [{ url: item.audioUrl, filename: audioFileName, fields: ['Audio'] }] }),
            };
            toAdd.push(noteParam);
        }
        else {
            let fieldsToUpdate = {};
            if (note.fields.Translation.value !== item.translation)
                fieldsToUpdate['Translation'] = item.translation;
            if (note.fields.Note.value !== sentenceNote)
                fieldsToUpdate['Note'] = sentenceNote;
            if (note.fields.IPA.value !== IPAFieldValue)
                fieldsToUpdate['IPA'] = IPAFieldValue;
            if (Object.keys(fieldsToUpdate).length > 0) {
                toUpdate.push({ id: note.noteId, fields: fieldsToUpdate });
            }
        }
    }
    for (let note of existingNotes) {
        if (!userData.find((item) => item.id === note.fields.dbID?.value)) {
            toDelete.push(note.noteId);
        }
    }
    // perform actions
    const batchSize = 100;
    let limit = pLimit(10);
    try {
        for (let i = 0; i < toAdd.length; i += batchSize) {
            let batch = toAdd.slice(i, i + batchSize);
            await invokeAnkiConnect('addNotes', { notes: batch });
        }
        console.log(`${toAdd.length} notes added`);
    }
    catch (err) {
        console.error('AddNotes failed:', err);
        process.exit(1);
    }
    try {
        for (let i = 0; i < toUpdate.length; i += batchSize) {
            let batch = toUpdate.slice(i, i + batchSize);
            await limit.map(batch, (item) => invokeAnkiConnect('updateNoteFields', { note: item }));
        }
        console.log(`${toUpdate.length} notes updated`);
    }
    catch (err) {
        console.error('UpdateNotes failed:', err);
        process.exit(1);
    }
    try {
        for (let i = 0; i < toDelete.length; i += batchSize) {
            let batch = toDelete.slice(i, i + batchSize);
            await invokeAnkiConnect('deleteNotes', { notes: batch });
        }
        console.log(`${toDelete.length} notes deleted`);
    }
    catch (err) {
        console.error('DeleteNotes failed:', err);
        process.exit(1);
    }
    console.log('Sync completed successfully!');
}
main().catch((err) => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
//# sourceMappingURL=sync-anki-cli.js.map