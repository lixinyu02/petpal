package com.petpal.app;

import android.net.Uri;
import android.os.ParcelFileDescriptor;
import androidx.core.content.FileProvider;
import java.io.FileNotFoundException;

/** Separate authority; only native-generated completed APK names can be read. */
public final class PetUpdateFileProvider extends FileProvider {
    private void requireApk(Uri uri) {
        if (!"content".equals(uri.getScheme()) || getContext() == null
            || !(getContext().getPackageName() + ".updater").equals(uri.getAuthority()) || uri.getQuery() != null
            || uri.getFragment() != null || uri.getEncodedPath() == null
            || !uri.getEncodedPath().matches("/verified_apk/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.apk")) throw new SecurityException("Unsupported update URI");
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        requireApk(uri);
        if (!"r".equals(mode)) throw new SecurityException("Updates are read-only");
        return super.openFile(uri, mode);
    }
    @Override public String getType(Uri uri) { requireApk(uri); return "application/vnd.android.package-archive"; }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { throw new SecurityException("Updates are read-only"); }
}
