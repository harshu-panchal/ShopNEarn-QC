import React, { useMemo } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';

/**
 * Word-style WYSIWYG editor used by admin content tools (legal pages,
 * announcements, etc.). Wraps `react-quill-new` with a sensible default
 * toolbar so admins never have to touch HTML.
 *
 * Output: clean HTML string passed back via `onChange`. The receiving
 * page is expected to sanitise the markup with DOMPurify before
 * rendering it to end users.
 */
const DEFAULT_TOOLBAR = [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    [{ indent: '-1' }, { indent: '+1' }],
    [{ align: [] }],
    ['blockquote', 'link'],
    ['clean'],
];

const DEFAULT_FORMATS = [
    'header',
    'bold',
    'italic',
    'underline',
    'strike',
    'list',
    'indent',
    'align',
    'blockquote',
    'link',
];

const RichTextEditor = ({
    value = '',
    onChange,
    placeholder = 'Start typing…',
    minHeight = 360,
    toolbar = DEFAULT_TOOLBAR,
    formats = DEFAULT_FORMATS,
}) => {
    const modules = useMemo(
        () => ({
            toolbar,
            clipboard: {
                // Strip pasted formatting noise (Word, Google Docs) so
                // the rendered output stays clean — only the formats
                // declared above survive.
                matchVisual: false,
            },
        }),
        [toolbar],
    );

    return (
        <div className="rich-text-editor" style={{ '--rte-min-height': `${minHeight}px` }}>
            <ReactQuill
                theme="snow"
                value={value || ''}
                onChange={onChange}
                modules={modules}
                formats={formats}
                placeholder={placeholder}
            />
        </div>
    );
};

export default RichTextEditor;
