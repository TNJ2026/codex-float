// Shell APIs require ordinary drive/UNC paths rather than canonical verbatim
// paths. Work in UTF-16 to preserve Windows filenames without Unicode conversion.
pub(super) fn shell_path(path: &[u16]) -> Vec<u16> {
    const VERBATIM: &[u16] = &[92, 92, 63, 92];
    const UNC: &[u16] = &[85, 78, 67, 92];
    let mut result = match path.strip_prefix(VERBATIM) {
        Some(tail) if tail.starts_with(UNC) => {
            let mut result = vec![92, 92];
            result.extend_from_slice(&tail[UNC.len()..]);
            result
        }
        Some(tail)
            if tail.len() >= 3
                && matches!(tail[0], 65..=90 | 97..=122)
                && tail[1..3] == [58, 92] =>
        {
            tail.to_vec()
        }
        _ => path.to_vec(),
    };
    result.push(0);
    result
}

#[cfg(test)]
mod tests {
    use super::shell_path;

    #[test]
    fn canonical_drive_and_network_paths_keep_their_absolute_roots() {
        for (input, expected) in [
            (r"\\?\C:\项目\report.pdf", r"C:\项目\report.pdf"),
            (
                r"\\?\UNC\server\share\report.pdf",
                r"\\server\share\report.pdf",
            ),
            (r"\\server\share\report.pdf", r"\\server\share\report.pdf"),
            (r"C:\report.pdf", r"C:\report.pdf"),
            (r"\\?\Volume{test}\file", r"\\?\Volume{test}\file"),
        ] {
            let wide: Vec<u16> = input.encode_utf16().collect();
            let expected: Vec<u16> = expected.encode_utf16().chain(Some(0)).collect();
            assert_eq!(shell_path(&wide), expected, "{input}");
        }
    }

    #[test]
    fn windows_filenames_preserve_unpaired_utf16_surrogates() {
        let mut input: Vec<u16> = r"\\?\UNC\server\share\".encode_utf16().collect();
        input.push(0xd800);
        let mut expected: Vec<u16> = r"\\server\share\".encode_utf16().collect();
        expected.extend([0xd800, 0]);
        assert_eq!(shell_path(&input), expected);
    }
}
